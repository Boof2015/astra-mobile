package expo.modules.astracar

import android.content.Context
import android.os.SystemClock
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import org.json.JSONObject

/** Only a paused resume card is persisted; native playback owns live state. */
object AstraCarNowPlayingStore {
  fun save(context: Context, snapshot: AstraCarPlaybackSnapshot) {
    val track = snapshot.track?.takeUnless { it.path.startsWith("https://", true) || it.path.startsWith("http://", true) }
    val json = JSONObject().put("savedAt", System.currentTimeMillis()).put("positionMs", snapshot.positionMs).put("durationMs", snapshot.durationMs)
    if (track != null) json.put("track", JSONObject()
      .put("path", track.path).put("title", track.title).put("artist", track.artist).put("album", track.album)
      .put("artwork", track.artwork?.takeIf { it.startsWith("file://") })
      .put("sourceId", track.sourceId).put("artworkSourceId", track.artworkSourceId)
      .put("entryId", track.entryId).put("queuePosition", track.queuePosition).put("sessionId", track.sessionId))
    context.getSharedPreferences("astra_car_now_playing", Context.MODE_PRIVATE).edit()
      .putString("native_resume", json.toString()).remove("state").apply()
  }

  fun load(context: Context): AstraCarPlaybackSnapshot {
    val json = runCatching {
      JSONObject(context.getSharedPreferences("astra_car_now_playing", Context.MODE_PRIVATE)
        .getString("native_resume", "{}") ?: "{}")
    }.getOrDefault(JSONObject())
    if (!json.has("track")) {
      val legacy = runCatching { JSONObject(context.getSharedPreferences("astra_car_now_playing", Context.MODE_PRIVATE).getString("state", "{}") ?: "{}") }.getOrNull()
      val path = legacy?.nullable("trackPath")
      if (path != null) return AstraCarPlaybackSnapshot(0, 0,
        AstraCarTrack(path, legacy.optString("title"), legacy.optString("artist"), legacy.optString("album"),
          entryId = "legacy", queuePosition = 0), "paused",
        (legacy.optDouble("positionSeconds", 0.0) * 1000).toLong(),
        (legacy.optDouble("durationSeconds", 0.0) * 1000).toLong(), 0f, SystemClock.elapsedRealtime())
    }
    val track = json.optJSONObject("track")?.let {
      AstraCarTrack(it.optString("path"), it.optString("title"), it.optString("artist"), it.optString("album"),
        artwork = it.nullable("artwork"), sourceId = if (it.isNull("sourceId")) null else it.optLong("sourceId"),
        artworkSourceId = it.nullable("artworkSourceId"), entryId = it.optString("entryId"),
        queuePosition = it.optLong("queuePosition"), sessionId = it.nullable("sessionId"))
    }
    return AstraCarPlaybackSnapshot(0, 0, track, if (track != null) "paused" else "stopped",
      json.optLong("positionMs"), json.optLong("durationMs"), 0f, SystemClock.elapsedRealtime())
  }

  fun resumeState(context: Context): Map<String, Any?> {
    val prefs = context.getSharedPreferences("astra_car_now_playing", Context.MODE_PRIVATE)
    val snapshot = load(context)
    return mapOf("path" to snapshot.track?.path, "position" to snapshot.positionMs / 1000.0,
      "session" to snapshot.track?.sessionId, "entryId" to snapshot.track?.entryId,
      "queuePosition" to snapshot.track?.queuePosition?.toDouble(),
      "shuffle" to prefs.getBoolean("shuffle", false), "repeat" to (prefs.getString("repeat", "none") ?: "none"),
      "savedAt" to runCatching { JSONObject(prefs.getString("native_resume", "{}") ?: "{}").optLong("savedAt").toDouble() }.getOrDefault(0.0))
  }

  private fun JSONObject.nullable(key: String): String? = if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() }
}

/** Metadata and playback state have independent lifetimes: changing a button never reloads art. */
class AstraCarSessionPresenter(private val context: Context, private val session: MediaSessionCompat) {
  private var metadataKey: List<Any?>? = null

  fun apply(snapshot: AstraCarPlaybackSnapshot, favorite: Boolean, activeQueueId: Long, hasNext: Boolean, hasPrevious: Boolean) {
    val track = snapshot.track
    val art = track?.let { AstraCarArtwork.forTrack(context, it).toString() }
    val mediaId = track?.let {
      AstraCarMediaIds.encode(AstraCarMediaId("queueEntry", key = it.entryId,
        session = it.sessionId ?: "native:${snapshot.generation}"))
    }
    val key = listOf(mediaId, track?.title, track?.artist, track?.album, art, snapshot.durationMs)
    if (metadataKey != key) {
      metadataKey = key
      session.setMetadata(MediaMetadataCompat.Builder().apply {
        putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, mediaId)
        putString(MediaMetadataCompat.METADATA_KEY_TITLE, track?.title?.take(512))
        putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, track?.title?.take(512))
        putString(MediaMetadataCompat.METADATA_KEY_ARTIST, track?.artist?.take(512))
        putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, track?.artist?.take(512))
        putString(MediaMetadataCompat.METADATA_KEY_ALBUM, track?.album?.take(512))
        putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_DESCRIPTION, track?.album?.take(512))
        putString(MediaMetadataCompat.METADATA_KEY_ART_URI, art)
        putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, art)
        putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON_URI, art)
        putLong(MediaMetadataCompat.METADATA_KEY_DURATION, snapshot.durationMs.coerceAtLeast(0))
      }.build())
    }
    var actions = PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID or
      PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH
    if (track != null) actions = actions or PlaybackStateCompat.ACTION_PAUSE or PlaybackStateCompat.ACTION_STOP or
      PlaybackStateCompat.ACTION_PLAY_PAUSE or PlaybackStateCompat.ACTION_SET_SHUFFLE_MODE or PlaybackStateCompat.ACTION_SET_REPEAT_MODE
    if (track != null && snapshot.durationMs > 0) actions = actions or PlaybackStateCompat.ACTION_SEEK_TO
    if (hasNext) actions = actions or PlaybackStateCompat.ACTION_SKIP_TO_NEXT
    if (hasPrevious) actions = actions or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
    if (activeQueueId != MediaSessionCompat.QueueItem.UNKNOWN_ID.toLong()) actions = actions or PlaybackStateCompat.ACTION_SKIP_TO_QUEUE_ITEM
    val state = when (snapshot.state) {
      "playing" -> PlaybackStateCompat.STATE_PLAYING
      "loading" -> PlaybackStateCompat.STATE_BUFFERING
      "paused" -> PlaybackStateCompat.STATE_PAUSED
      "error" -> PlaybackStateCompat.STATE_ERROR
      else -> PlaybackStateCompat.STATE_STOPPED
    }
    val shuffle = AstraCarPlaybackBridge.shuffle
    val repeat = AstraCarPlaybackBridge.repeat
    session.setShuffleMode(if (shuffle) PlaybackStateCompat.SHUFFLE_MODE_ALL else PlaybackStateCompat.SHUFFLE_MODE_NONE)
    session.setRepeatMode(when (repeat) {
      "all" -> PlaybackStateCompat.REPEAT_MODE_ALL
      "one" -> PlaybackStateCompat.REPEAT_MODE_ONE
      else -> PlaybackStateCompat.REPEAT_MODE_NONE
    })
    session.setPlaybackState(PlaybackStateCompat.Builder().setActions(actions)
      .setState(state, snapshot.positionMs.coerceAtLeast(0), snapshot.speed, snapshot.updatedAt)
      .setBufferedPosition(snapshot.bufferedPositionMs).setActiveQueueItemId(activeQueueId).apply {
        if (track != null) {
          addCustomAction(if (shuffle) "shuffleOff" else "shuffleOn", if (shuffle) "Turn shuffle off" else "Turn shuffle on",
            if (shuffle) R.drawable.ic_astra_shuffle else R.drawable.ic_astra_shuffle_off)
          addCustomAction("cycleRepeat", "Repeat: ${if (repeat == "none") "off" else repeat}", when (repeat) {
            "one" -> R.drawable.ic_astra_repeat_one
            "all" -> R.drawable.ic_astra_repeat
            else -> R.drawable.ic_astra_repeat_off
          })
          addCustomAction(AstraCarFavoriteAction.TOGGLE, if (favorite) "Unfavorite" else "Favorite",
            if (favorite) R.drawable.ic_astra_favorite else R.drawable.ic_astra_favorite_border)
        }
        (snapshot.error ?: AstraCarPlaybackBridge.commandError)?.let {
          setErrorMessage(PlaybackStateCompat.ERROR_CODE_APP_ERROR, it)
        }
      }.build())
    session.isActive = track != null || snapshot.state == "loading"
  }
}
