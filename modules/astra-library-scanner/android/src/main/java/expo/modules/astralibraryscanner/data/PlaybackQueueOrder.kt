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
