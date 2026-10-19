package expo.modules.astracar

/** An occurrence, including the engine generation and Room replacement epoch. */
internal data class AstraCarQueueIdentity(val generation: Long, val session: String, val entryId: String?) {
  companion object {
    fun of(snapshot: AstraCarPlaybackSnapshot, track: AstraCarTrack? = snapshot.track) =
      AstraCarQueueIdentity(snapshot.generation, track?.sessionId ?: "native:${snapshot.generation}", track?.entryId)
  }
}

internal data class AstraCarQueueWindow(
  val identity: AstraCarQueueIdentity,
  val tracks: List<AstraCarTrack>,
  val count: Long,
  val position: Long,
  val revision: Long? = null,
)

/** Main-thread projection. Advancing the active occurrence never waits for a database read. */
internal class AstraCarSessionQueue {
  data class Entry(val id: Long, val identity: AstraCarQueueIdentity, val track: AstraCarTrack)

  private var identity: AstraCarQueueIdentity? = null
  private var nextId = 0L
  private val ids = mutableMapOf<AstraCarQueueIdentity, Long>()
  var entries = emptyList<Entry>()
    private set
  var count = 0L
    private set
  var position = 0L
    private set
  val activeId get() = entries.firstOrNull()?.id ?: -1L

  fun align(snapshot: AstraCarPlaybackSnapshot) {
    val next = AstraCarQueueIdentity.of(snapshot)
    val sameQueue = identity?.generation == next.generation && identity?.session == next.session
    val active = snapshot.track
    if (active == null) {
      count = 0
      position = 0
      replace(snapshot, emptyList())
    } else {
      val hasRuntimeQueue = active.sessionId != null || snapshot.queueCount > 0
      val index = if (sameQueue && hasRuntimeQueue) entries.indexOfFirst { it.identity == next } else -1
      if (identity != next) {
        position = active.queuePosition
        if (!sameQueue) count = snapshot.queueCount.toLong()
      }
      if (active.sessionId == null) {
        count = snapshot.queueCount.toLong()
        position = snapshot.nativeIndex.takeIf { it >= 0 }?.toLong() ?: active.queuePosition
      }
      // A backward/out-of-window jump starts with a singleton, never the old queue head.
      replace(snapshot, listOf(active) + if (index >= 0) entries.drop(index + 1).map { it.track } else emptyList())
    }
    identity = next
  }

  fun apply(snapshot: AstraCarPlaybackSnapshot, window: AstraCarQueueWindow): Boolean {
    if (window.identity != AstraCarQueueIdentity.of(snapshot)) return false
    align(snapshot)
    val active = snapshot.track
    if (active != null && window.tracks.firstOrNull()?.entryId != active.entryId) return false
    count = window.count
    position = window.position
    replace(snapshot, if (active == null) emptyList() else listOf(active) + window.tracks.drop(1))
    return true
  }

  private fun replace(snapshot: AstraCarPlaybackSnapshot, tracks: List<AstraCarTrack>) {
    entries = tracks.take(100).map { track ->
      val key = AstraCarQueueIdentity.of(snapshot, track)
      Entry(ids.getOrPut(key) { ++nextId }, key, track)
    }
    // Keep memory bounded; IDs that leave the window are never recycled for another occurrence.
    ids.keys.retainAll(entries.map { it.identity }.toSet())
  }
}
