package expo.modules.astralibraryscanner.data

import kotlin.random.Random

internal data class OrderedQueueItem(
  val entryId: Long,
  val trackPath: String,
)

internal data class PlaybackQueueOrder(
  val entries: List<OrderedQueueItem>,
  val activePosition: Int,
)

/** Positions identify occurrences even when the same path appears more than once. */
internal fun restoredPlaybackActiveIndex(retainedPositions: List<Long>, activePosition: Long): Int =
  retainedPositions.indexOfLast { it <= activePosition }.coerceAtLeast(0)

/**
 * The id to give the next row added to a queue.
 *
 * The session's counter is the normal source, but a row's id is its primary
 * key and additions are written with an upsert: an id that is already taken
 * does not fail, it relocates the existing row and leaves a hole in the
 * position column. So never trust the counter below the ids actually in use.
 */
internal fun nextFreeQueueEntryId(sessionNextEntryId: Long, existingEntryIds: Iterable<Long>): Long =
  maxOf(sessionNextEntryId, (existingEntryIds.maxOrNull() ?: -1L) + 1L)

internal fun createPlaybackQueueOrder(
  original: List<OrderedQueueItem>,
  anchorPath: String?,
  shuffle: Boolean,
  seed: Long,
): PlaybackQueueOrder {
  val anchorIndex = anchorPath
    ?.let { anchor -> original.indexOfFirst { it.trackPath == anchor } }
    ?.takeIf { it >= 0 }
  val ordered = original.toMutableList()
  if (!shuffle) return PlaybackQueueOrder(ordered, anchorIndex ?: 0)

  // Only an explicitly selected occurrence stays first. A collection Shuffle
  // action has no anchor, so every entry must participate in the shuffle.
  val anchor = anchorIndex?.let { ordered.removeAt(it) }
  ordered.shuffle(Random(seed))
  if (anchor != null) ordered.add(0, anchor)
  return PlaybackQueueOrder(ordered, 0)
}
