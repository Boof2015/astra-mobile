package expo.modules.astracar

/** Immutable, credential-free identity. Queue keys identify occurrences, not songs. */
data class AstraCarTrack(
  val path: String,
  val title: String,
  val artist: String,
  val album: String,
  val artwork: String? = null,
  val sourceId: Long? = null,
  val artworkSourceId: String? = null,
  val entryId: String,
  val queuePosition: Long,
  val durationMs: Long = 0,
  val sessionId: String? = null,
)

data class AstraCarPlaybackSnapshot(
  val generation: Long,
  val sequence: Long,
  val track: AstraCarTrack?,
  val state: String,
  val positionMs: Long,
  val durationMs: Long,
  val speed: Float,
  val updatedAt: Long,
  val bufferedPositionMs: Long = 0,
  val queueCount: Int = 0,
  val nativeIndex: Int = -1,
  val error: String? = null,
)

/** Pure policy, also exercised without Android or a running React instance. */
object AstraCarSnapshotPolicy {
  fun accepts(current: AstraCarPlaybackSnapshot?, next: AstraCarPlaybackSnapshot): Boolean =
    current == null || next.generation > current.generation ||
      (next.generation == current.generation && next.sequence > current.sequence)

  fun position(snapshot: AstraCarPlaybackSnapshot, now: Long): Long {
    val elapsed = if (snapshot.state == "playing") {
      ((now - snapshot.updatedAt).coerceAtLeast(0) * snapshot.speed).toLong()
    } else 0L
    val position = (snapshot.positionMs.coerceAtLeast(0) + elapsed).coerceAtLeast(0)
    return if (snapshot.durationMs > 0) position.coerceAtMost(snapshot.durationMs) else position
  }
}
