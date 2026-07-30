package expo.modules.astralibraryscanner.queue

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
}
