package expo.modules.astracar

import android.content.Context
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import org.json.JSONObject
import java.lang.ref.WeakReference

data class AstraCarNowPlayingState(
  val title: String?,
  val artist: String?,
  val album: String?,
  val artworkUri: String?,
  val playbackState: String,
  val hasTrack: Boolean,
  val durationSeconds: Double?,
  val positionSeconds: Double?,
  val trackPath: String?,
  val isFavorite: Boolean,
)

object AstraCarNowPlayingStore {
  private const val PREFS_NAME = "astra_car_now_playing"
  private const val KEY_STATE = "state"

  private var serviceRef: WeakReference<AstraCarMediaService>? = null

  fun attach(service: AstraCarMediaService) {
    serviceRef = WeakReference(service)
  }

  fun detach(service: AstraCarMediaService) {
    if (serviceRef?.get() === service) serviceRef = null
  }

  fun saveAndApply(context: Context, state: AstraCarNowPlayingState) {
    context.applicationContext
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_STATE, encode(state))
      .apply()
    serviceRef?.get()?.applyNowPlaying(state)
  }

  fun load(context: Context): AstraCarNowPlayingState =
    decode(
      context.applicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .getString(KEY_STATE, null),
    )

  fun buildMetadata(state: AstraCarNowPlayingState): MediaMetadataCompat =
    MediaMetadataCompat.Builder().apply {
      state.title?.let {
        putString(MediaMetadataCompat.METADATA_KEY_TITLE, it)
        putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, it)
      }
      state.artist?.let {
        putString(MediaMetadataCompat.METADATA_KEY_ARTIST, it)
        putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, it)
      }
      state.album?.let {
        putString(MediaMetadataCompat.METADATA_KEY_ALBUM, it)
        putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_DESCRIPTION, it)
      }
      state.artworkUri?.let {
        putString(MediaMetadataCompat.METADATA_KEY_ART_URI, it)
        putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON_URI, it)
      }
      state.durationSeconds?.let {
        putLong(MediaMetadataCompat.METADATA_KEY_DURATION, (it * 1000).toLong())
      }
    }.build()

  fun buildPlaybackState(state: AstraCarNowPlayingState): PlaybackStateCompat {
    val playbackState = when (state.playbackState) {
      "playing" -> PlaybackStateCompat.STATE_PLAYING
      "paused" -> PlaybackStateCompat.STATE_PAUSED
      "loading" -> PlaybackStateCompat.STATE_BUFFERING
      else -> PlaybackStateCompat.STATE_STOPPED
    }
    val actions =
      PlaybackStateCompat.ACTION_PLAY or
        PlaybackStateCompat.ACTION_PAUSE or
        PlaybackStateCompat.ACTION_PLAY_PAUSE or
        PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
        PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
        PlaybackStateCompat.ACTION_SEEK_TO or
        PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID or
        PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH
    return PlaybackStateCompat.Builder()
      .setActions(actions)
      .setState(
        playbackState,
        ((state.positionSeconds ?: 0.0) * 1000).toLong(),
        if (playbackState == PlaybackStateCompat.STATE_PLAYING) 1f else 0f,
      )
      .apply {
        favoriteAction(state)?.let(::addCustomAction)
      }
      .build()
  }

  private fun favoriteAction(state: AstraCarNowPlayingState): PlaybackStateCompat.CustomAction? {
    if (!state.hasTrack || state.trackPath.isNullOrBlank()) return null
    val label = if (state.isFavorite) "Unfavorite" else "Favorite"
    val icon = if (state.isFavorite) R.drawable.ic_astra_favorite else R.drawable.ic_astra_favorite_border
    return PlaybackStateCompat.CustomAction.Builder(AstraCarFavoriteAction.TOGGLE, label, icon).build()
  }

  private fun encode(state: AstraCarNowPlayingState): String =
    JSONObject()
      .put("title", state.title)
      .put("artist", state.artist)
      .put("album", state.album)
      .put("artworkUri", state.artworkUri)
      .put("playbackState", state.playbackState)
      .put("hasTrack", state.hasTrack)
      .put("durationSeconds", state.durationSeconds)
      .put("positionSeconds", state.positionSeconds)
      .put("trackPath", state.trackPath)
      .put("isFavorite", state.isFavorite)
      .toString()

  private fun decode(value: String?): AstraCarNowPlayingState {
    if (value.isNullOrBlank()) return emptyState()
    return runCatching {
      val json = JSONObject(value)
      AstraCarNowPlayingState(
        title = json.optNullableString("title"),
        artist = json.optNullableString("artist"),
        album = json.optNullableString("album"),
        artworkUri = json.optNullableString("artworkUri"),
        playbackState = json.optString("playbackState", "stopped"),
        hasTrack = json.optBoolean("hasTrack", false),
        durationSeconds = json.optDoubleOrNull("durationSeconds"),
        positionSeconds = json.optDoubleOrNull("positionSeconds"),
        trackPath = json.optNullableString("trackPath"),
        isFavorite = json.optBoolean("isFavorite", false),
      )
    }.getOrDefault(emptyState())
  }

  private fun emptyState(): AstraCarNowPlayingState =
    AstraCarNowPlayingState(
      title = null,
      artist = null,
      album = null,
      artworkUri = null,
      playbackState = "stopped",
      hasTrack = false,
      durationSeconds = null,
      positionSeconds = null,
      trackPath = null,
      isFavorite = false,
    )

  private fun JSONObject.optNullableString(key: String): String? {
    if (!has(key) || isNull(key)) return null
    return optString(key).trim().takeIf { it.isNotEmpty() }
  }

  private fun JSONObject.optDoubleOrNull(key: String): Double? {
    if (!has(key) || isNull(key)) return null
    val value = optDouble(key)
    return if (value.isNaN()) null else value
  }
}

fun MediaSessionCompat.applyAstraState(state: AstraCarNowPlayingState) {
  setMetadata(AstraCarNowPlayingStore.buildMetadata(state))
  setPlaybackState(AstraCarNowPlayingStore.buildPlaybackState(state))
  isActive = state.hasTrack || state.playbackState != "stopped"
}
