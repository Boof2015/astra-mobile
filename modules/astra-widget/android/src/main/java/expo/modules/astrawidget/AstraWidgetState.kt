package expo.modules.astrawidget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class AstraWidgetState(
  val title: String?,
  val artist: String?,
  val artworkUri: String?,
  val playbackState: String,
  val hasTrack: Boolean,
  val recentlyPlayed: List<AstraWidgetRecentItem>,
)

data class AstraWidgetRecentItem(
  val title: String?,
  val artist: String?,
  val artworkUri: String?,
)

object AstraWidgetStateStore {
  private const val PREFS_NAME = "astra_widget_now_playing"
  private const val KEY_TITLE = "title"
  private const val KEY_ARTIST = "artist"
  private const val KEY_ARTWORK_URI = "artwork_uri"
  private const val KEY_PLAYBACK_STATE = "playback_state"
  private const val KEY_HAS_TRACK = "has_track"
  private const val KEY_RECENTLY_PLAYED = "recently_played"

  fun save(context: Context, state: AstraWidgetState) {
    context.applicationContext
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_TITLE, state.title)
      .putString(KEY_ARTIST, state.artist)
      .putString(KEY_ARTWORK_URI, state.artworkUri)
      .putString(KEY_PLAYBACK_STATE, state.playbackState)
      .putBoolean(KEY_HAS_TRACK, state.hasTrack)
      .putString(KEY_RECENTLY_PLAYED, encodeRecentlyPlayed(state.recentlyPlayed))
      .apply()
  }

  fun load(context: Context): AstraWidgetState {
    val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    return AstraWidgetState(
      title = prefs.getString(KEY_TITLE, null),
      artist = prefs.getString(KEY_ARTIST, null),
      artworkUri = prefs.getString(KEY_ARTWORK_URI, null),
      playbackState = prefs.getString(KEY_PLAYBACK_STATE, "stopped") ?: "stopped",
      hasTrack = prefs.getBoolean(KEY_HAS_TRACK, false),
      recentlyPlayed = decodeRecentlyPlayed(prefs.getString(KEY_RECENTLY_PLAYED, null)),
    )
  }

  private fun encodeRecentlyPlayed(items: List<AstraWidgetRecentItem>): String {
    val array = JSONArray()
    items.take(8).forEach { item ->
      array.put(
        JSONObject()
          .put("title", item.title)
          .put("artist", item.artist)
          .put("artworkUri", item.artworkUri),
      )
    }
    return array.toString()
  }

  private fun decodeRecentlyPlayed(value: String?): List<AstraWidgetRecentItem> {
    if (value.isNullOrBlank()) return emptyList()

    return runCatching {
      val array = JSONArray(value)
      buildList {
        for (index in 0 until minOf(array.length(), 8)) {
          val item = array.optJSONObject(index) ?: continue
          add(
            AstraWidgetRecentItem(
              title = item.optNullableString("title"),
              artist = item.optNullableString("artist"),
              artworkUri = item.optNullableString("artworkUri"),
            ),
          )
        }
      }
    }.getOrDefault(emptyList())
  }

  private fun JSONObject.optNullableString(key: String): String? {
    if (!has(key) || isNull(key)) return null
    return optString(key).trim().takeIf { it.isNotEmpty() }
  }
}
