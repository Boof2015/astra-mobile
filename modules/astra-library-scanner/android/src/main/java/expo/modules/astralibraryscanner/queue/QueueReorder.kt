package expo.modules.astralibraryscanner.queue

/**
 * Positions are parked into this disjoint space while an edit is in flight.
 *
 * `playback_queue_entries` has a unique `(session_id, position)` index, and a
 * bulk `UPDATE ... SET position = position + delta` would violate it the moment
 * SQLite visits rows in an order where a row lands on a slot not yet vacated —
 * an order the query planner does not promise. Moving the affected rows clear of
 * the real position space first makes every write collision-free regardless of
 * visit order.
 */
const val QUEUE_PARK_OFFSET = 1_000_000_000_000L

/** One `UPDATE ... SET position = position + delta` over an inclusive range. */
data class QueueShift(
  val fromPosition: Long,
  val toPosition: Long,
  val delta: Long,
)

/**
 * The statement sequence that relocates one row, leaving positions dense.
 *
 * The moved row parks below the span so the two never collide even when the
 * destination is position zero.
 */
data class QueueMovePlan(
  val parkedMovedPosition: Long,
  val spanOut: QueueShift?,
  val spanBack: QueueShift?,
  val finalPosition: Long,
)

/** Identity of one queue row, decoupled from the Room entity so it stays JVM-testable. */
data class QueueRowKey(
  val entryId: Long,
  val trackPath: String,
  val position: Long,
)

/**
 * How to persist an order change.
 *
 * [Removal] and [Move] are the edits a user actually performs on an open queue,
 * and both are expressible as a handful of `UPDATE`s over a position range.
 * Anything else — shuffle, append, insert-after-active — falls back to
 * [Rebuild], which rewrites rows from the change point. Detection is
 * conservative on purpose: an unrecognised shape costs the old behaviour, never
 * a wrong order.
 */
sealed interface QueueWritePlan {
  data class Removal(
    val removedIds: List<Long>,
    val removedPositions: List<Long>,
  ) : QueueWritePlan

  data class Move(
    val entryId: Long,
    val from: Long,
    val to: Long,
  ) : QueueWritePlan

  /** Order is unchanged; only the session row needs writing. */
  data object NoChange : QueueWritePlan

  data object Rebuild : QueueWritePlan
}

/**
 * Pure index math shared by the queue view and the playback repository.
 *
 * The native queue only renders rows after the active track, so adapter indices
 * and Room queue positions differ by the active position. Keeping that
 * translation and the commit-side move semantics in one tested place is what
 * stops the view and the database from drifting — the same divergence that bit
 * the vendored kotlin-audio metadata list.
 */
object QueueReorder {
  /** Room queue position of the row rendered at [adapterIndex]. */
  fun queuePosition(activePosition: Long, adapterIndex: Int): Long =
    activePosition + 1L + adapterIndex

  /** Adapter index of the row at [queuePosition], or -1 when it is not upcoming. */
  fun adapterIndex(activePosition: Long, queuePosition: Long): Int {
    val index = queuePosition - activePosition - 1L
    return if (index < 0L || index > Int.MAX_VALUE) -1 else index.toInt()
  }

  /**
   * Move [from] to [to] as remove-then-insert.
   *
   * Both directions land the item at exactly [to]. That is the contract
   * `ItemTouchHelper.onMove` reports, and it is what lets the view derive a
   * destination from the dragged row's *final* adapter index instead of
   * accumulating per-step targets — fast auto-scroll drops intermediate
   * `onMove` callbacks, so the accumulated target is not reliable.
   */
  fun <T> applyMove(items: MutableList<T>, from: Int, to: Int): Boolean {
    if (from !in items.indices || to !in items.indices || from == to) return false
    val item = items.removeAt(from)
    items.add(to.coerceIn(0, items.size), item)
    return true
  }

  /**
   * Range shifts that re-densify positions after the rows at [removedPositions]
   * have been deleted and everything from the first gap onwards has been parked
   * by [parkOffset].
   *
   * A surviving row at original position `q` must end up at
   * `q - (removed positions below q)`, so rows between consecutive gaps share a
   * shift and each gap deepens it by one. That collapses an edit into one
   * statement per removed row instead of one row-write per surviving row.
   */
  fun compactionShifts(
    removedPositions: List<Long>,
    parkOffset: Long = QUEUE_PARK_OFFSET,
  ): List<QueueShift> {
    val gaps = removedPositions.distinct().sorted()
    if (gaps.isEmpty()) return emptyList()
    return gaps
      .mapIndexed { index, position ->
        QueueShift(
          fromPosition = parkOffset + position + 1L,
          // The final segment runs to the end of the parked space.
          toPosition = gaps.getOrNull(index + 1)?.let { parkOffset + it - 1L } ?: Long.MAX_VALUE,
          delta = -parkOffset - (index + 1L),
        )
      }
      // Adjacent gaps enclose no rows.
      .filter { it.fromPosition <= it.toPosition }
  }

  /**
   * Statement sequence to move the row at [from] to [to], keeping positions
   * dense. Returns null when the move is a no-op.
   *
   * Matches [applyMove]: the row ends at exactly [to] in both directions.
   */
  /**
   * Classify an order change so the common edits can be written as position
   * arithmetic instead of rewriting every row from the change point onward.
   *
   * [before] must already be dense and ordered by position (what
   * `ORDER BY position` yields for an intact queue); anything else returns
   * [QueueWritePlan.Rebuild], as does any shape this does not positively
   * recognise.
   */
  fun planWrite(
    before: List<QueueRowKey>,
    after: List<QueueRowKey>,
  ): QueueWritePlan {
    if (before.isEmpty() || after.isEmpty()) return QueueWritePlan.Rebuild
    if (!isDense(before) || !isDense(after)) return QueueWritePlan.Rebuild
    return when {
      after.size < before.size -> planRemoval(before, after)
      after.size == before.size -> planMove(before, after)
      else -> QueueWritePlan.Rebuild
    }
  }

  private fun isDense(rows: List<QueueRowKey>): Boolean =
    rows.withIndex().all { (index, row) -> row.position == index.toLong() }

  private fun planRemoval(
    before: List<QueueRowKey>,
    after: List<QueueRowKey>,
  ): QueueWritePlan {
    val keptIds = after.mapTo(HashSet(after.size), QueueRowKey::entryId)
    val removedIds = ArrayList<Long>(before.size - after.size)
    val removedPositions = ArrayList<Long>(before.size - after.size)
    val survivors = ArrayList<QueueRowKey>(after.size)
    before.forEach { row ->
      if (row.entryId in keptIds) {
        survivors.add(row)
      } else {
        removedIds.add(row.entryId)
        removedPositions.add(row.position)
      }
    }
    if (survivors.size != after.size || removedIds.isEmpty()) return QueueWritePlan.Rebuild
    // Survivors must keep both identity and relative order for a compaction to
    // reproduce `after` exactly.
    for (index in after.indices) {
      if (
        survivors[index].entryId != after[index].entryId ||
        survivors[index].trackPath != after[index].trackPath
      ) return QueueWritePlan.Rebuild
    }
    return QueueWritePlan.Removal(removedIds, removedPositions)
  }

  private fun planMove(
    before: List<QueueRowKey>,
    after: List<QueueRowKey>,
  ): QueueWritePlan {
    var first = -1
    var last = -1
    for (index in before.indices) {
      if (before[index].entryId != after[index].entryId) {
        if (first < 0) first = index
        last = index
      }
    }
    if (first < 0) return QueueWritePlan.NoChange
    // A single relocation shows up as a rotation of [first, last] by one, in
    // whichever direction the row travelled.
    val movedDown = matchesRotation(before, after, first, last, movedDown = true)
    val movedUp = matchesRotation(before, after, first, last, movedDown = false)
    return when {
      movedDown -> QueueWritePlan.Move(before[first].entryId, first.toLong(), last.toLong())
      movedUp -> QueueWritePlan.Move(before[last].entryId, last.toLong(), first.toLong())
      else -> QueueWritePlan.Rebuild
    }
  }

  private fun matchesRotation(
    before: List<QueueRowKey>,
    after: List<QueueRowKey>,
    first: Int,
    last: Int,
    movedDown: Boolean,
  ): Boolean {
    val moved = if (movedDown) before[first] else before[last]
    val landing = if (movedDown) last else first
    if (after[landing].entryId != moved.entryId || after[landing].trackPath != moved.trackPath) {
      return false
    }
    // The rest of the window shifts one slot toward the vacated end.
    for (index in first..last) {
      if (index == landing) continue
      val source = if (movedDown) before[index + 1] else before[index - 1]
      if (
        after[index].entryId != source.entryId ||
        after[index].trackPath != source.trackPath
      ) return false
    }
    return true
  }

  fun movePlan(
    from: Long,
    to: Long,
    parkOffset: Long = QUEUE_PARK_OFFSET,
  ): QueueMovePlan? {
    if (from == to || from < 0L || to < 0L) return null
    // Below the parked span, so a move to position zero cannot collide with it.
    val parkedMoved = parkOffset - 1L
    val spanStart = if (from < to) from + 1L else to
    val spanEnd = if (from < to) to else from - 1L
    val backDelta = if (from < to) -parkOffset - 1L else -parkOffset + 1L
    return QueueMovePlan(
      parkedMovedPosition = parkedMoved,
      spanOut = QueueShift(spanStart, spanEnd, parkOffset),
      spanBack = QueueShift(parkOffset + spanStart, parkOffset + spanEnd, backDelta),
      finalPosition = to,
    )
  }
}
