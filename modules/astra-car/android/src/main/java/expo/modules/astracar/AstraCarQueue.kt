package expo.modules.astracar

import android.content.Context
import org.json.JSONObject
import expo.modules.astralibraryscanner.data.AstraLibraryRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class AstraCarQueue(private val context: Context) {
  private val repository get() = AstraLibraryRepository.get(context)

  /** Restore a paused card and full Room queue before React or an engine exists. */
  suspend fun restoreCard() {
    repository.initialize()
    val saved = AstraCarNowPlayingStore.load(context)
    val prefs = context.getSharedPreferences("astra_car_now_playing", Context.MODE_PRIVATE)
    val runtimeCard = prefs.contains("native_resume") && saved.track?.sessionId == null
    if (runtimeCard) { AstraCarPlaybackBridge.restore(saved); return }
    val mobileSession = runCatching { JSONObject(repository.readMobileSession() ?: "{}") }.getOrNull()
    val mobile = mobileSession?.optJSONObject("playback")
    val savedAt = (AstraCarNowPlayingStore.resumeState(context)["savedAt"] as? Number)?.toLong() ?: 0L
    val dao = repository.userDb().userDao()
    val session = dao.getPlaybackSession("active-context")
    // Native transitions can reach disk before React updates Room's active row.
    val nativeEntry = saved.track?.takeIf {
      session != null && it.sessionId == "${session.id}:${session.createdAt}" && savedAt > (mobileSession?.optLong("savedAt") ?: 0L)
    }?.entryId?.toLongOrNull()?.let { dao.getQueueEntry("active-context", it) }
    val entry = nativeEntry ?: session?.let { dao.getQueueWindow(it.id, it.activePosition, 1).firstOrNull() }
    val track = entry?.let { repository.catalogDb().catalogDao().getActiveTrack(it.trackPath) }
    if (session == null || entry == null || track == null) { AstraCarPlaybackBridge.restore(saved); return }
    val mobilePath = mobile?.optJSONArray("queuePaths")?.optString(mobile.optInt("activeIndex"))
    val position = if (saved.track?.path == track.path && prefs.contains("native_resume")) saved.positionMs
      else if (mobilePath == track.path) ((mobile?.optDouble("position", 0.0) ?: 0.0) * 1000).toLong()
      else if (saved.track?.path == track.path) saved.positionMs else 0L
    val restored = AstraCarTrack(track.path, track.title, track.artist, track.album,
      track.artworkHash?.let { "file://${context.filesDir}/artwork/$it" }, track.sourceId, track.artworkSourceId,
      entry.entryId.toString(), entry.position, (track.duration * 1000).toLong(), "${session.id}:${session.createdAt}")
    AstraCarPlaybackBridge.restore(saved.copy(track = restored, positionMs = position, durationMs = restored.durationMs))
  }

  suspend fun current(): AstraCarPlaybackSnapshot = withContext(Dispatchers.Main.immediate) {
    AstraCarPlaybackBridge.snapshot ?: AstraCarNowPlayingStore.load(context)
  }

  suspend fun sessionId(): String {
    val snapshot = current()
    return snapshot.track?.sessionId ?: "native:${snapshot.generation}"
  }

  private suspend fun roomId(token: String): String? {
    val id = token.substringBeforeLast(':', "")
    val epoch = token.substringAfterLast(':').toLongOrNull() ?: return null
    return id.takeIf { repository.userDb().userDao().getPlaybackSession(id)?.createdAt == epoch }
  }

  suspend fun select(session: String, entryId: String): Map<String, Any?>? {
    if (session != sessionId()) return null
    val id = roomId(session) ?: return null
    val epoch = session.substringAfterLast(':').toLongOrNull() ?: return null
    val entry = repository.userDb().userDao().selectQueueOccurrence(id, epoch, entryId.toLongOrNull() ?: return null) ?: return null
    val window = repository.getPlaybackWindow(id, (entry.position - 10).coerceAtLeast(0), 100)
    if ((window["sessionEpoch"] as? Number)?.toLong() != epoch) return null
    val currentEntry = repository.userDb().userDao().getQueueEntry(id, entry.entryId) ?: return null
    val currentSession = repository.userDb().userDao().getPlaybackSession(id) ?: return null
    if (currentSession.createdAt != epoch || currentSession.queueRevision != (window["queueRevision"] as? Number)?.toLong() || currentEntry.position != entry.position) return null
    return window + ("activePosition" to currentEntry.position.toDouble())
  }

  suspend fun count(): Long {
    val snapshot = current()
    val roomSession = snapshot.track?.sessionId
    return if (roomSession != null) roomId(roomSession)?.let { repository.userDb().userDao().countQueueEntries(it) } ?: 0L
    else snapshot.queueCount.toLong()
  }

  suspend fun page(offset: Long, limit: Int): List<AstraCarTrack> {
    val snapshot = current()
    val session = snapshot.track?.sessionId
    if (session == null) return AstraCarPlaybackBridge.readQueue(offset.coerceAtMost(Int.MAX_VALUE.toLong()).toInt(), limit)
    val id = roomId(session) ?: return emptyList()
    val entries = repository.userDb().userDao().getQueueWindow(id, offset, limit)
    val tracks = repository.catalogDb().catalogDao().getActiveTracks(entries.map { it.trackPath }.distinct()).associateBy { it.path }
    return entries.mapNotNull { entry ->
      tracks[entry.trackPath]?.let { track ->
        AstraCarTrack(track.path, track.title, track.artist, track.album,
          track.artworkHash?.let { "file://${context.filesDir}/artwork/$it" }, track.sourceId, track.artworkSourceId,
          entry.entryId.toString(), entry.position, (track.duration * 1000).toLong(), session)
      }
    }
  }

  suspend fun resolve(session: String, entryId: String): Long? {
    if (session != sessionId()) return null
    if (!session.startsWith("native:")) {
      return entryId.toLongOrNull()?.let { roomId(session)?.let { id -> repository.userDb().userDao().getQueueEntry(id, it)?.position } }
    }
    val live = current()
    if (live.track?.entryId == entryId) return live.track.queuePosition
    var offset = 0
    val total = count().coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
    while (offset < total) {
      val entries = AstraCarPlaybackBridge.readQueue(offset, 100)
      entries.firstOrNull { it.entryId == entryId }?.let { return it.queuePosition }
      offset += 100
    }
    return null
  }
}
