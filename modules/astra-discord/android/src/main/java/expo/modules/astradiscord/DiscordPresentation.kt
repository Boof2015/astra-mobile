package expo.modules.astradiscord

import expo.modules.astracar.AstraCarTrack
import java.net.URLEncoder
import java.util.Locale
import kotlin.math.roundToLong

// Public "astra-logo" asset registered to application 1471059486100815915.
// Android RPC accepts the CDN image URL where the asset key is not rendered.
const val DISCORD_ASTRA_ICON = "https://cdn.discordapp.com/app-assets/1471059486100815915/1514803544304254976.png?size=512"

data class DiscordPreferences(
  val coverArtEnabled: Boolean = false,
  val smallIconEnabled: Boolean = true,
  val compactStatusMode: String = "title",
  val expandedInfoMode: String = "file-info",
  val linkDestination: String = "ytmusic",
  val pauseClearMinutes: Int = 5,
) {
  fun toMap(): Map<String, Any> = mapOf(
    "coverArtEnabled" to coverArtEnabled, "smallIconEnabled" to smallIconEnabled,
    "compactStatusMode" to compactStatusMode, "expandedInfoMode" to expandedInfoMode,
    "linkDestination" to linkDestination, "pauseClearMinutes" to pauseClearMinutes,
  )

  fun updated(values: Map<String, Any?>) = copy(
    coverArtEnabled = values["coverArtEnabled"] as? Boolean ?: coverArtEnabled,
    smallIconEnabled = values["smallIconEnabled"] as? Boolean ?: smallIconEnabled,
    compactStatusMode = (values["compactStatusMode"] as? String)?.takeIf { it in listOf("title", "artist") } ?: compactStatusMode,
    expandedInfoMode = (values["expandedInfoMode"] as? String)?.takeIf { it in listOf("file-info", "album") } ?: expandedInfoMode,
    linkDestination = (values["linkDestination"] as? String)?.takeIf { it in listOf("off", "ytmusic", "lastfm") } ?: linkDestination,
    pauseClearMinutes = (values["pauseClearMinutes"] as? Number)?.toInt()?.takeIf { it in listOf(0, 1, 5, 15, 30) } ?: pauseClearMinutes,
  )
}

data class DiscordActivity(
  val title: String, val state: String, val start: Long = 0, val end: Long = 0,
  val statusDisplay: Int = 2,
  val detailsUrl: String = "", val stateUrl: String = "",
  val largeImage: String = DISCORD_ASTRA_ICON, val largeText: String = "", val largeUrl: String = "",
  val smallImage: String = "",
)

object DiscordPresentation {
  fun encode(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
  private fun url(value: String) = value.takeIf { it.length <= 256 }.orEmpty()
  private fun search(vararg terms: String) = url("https://music.youtube.com/search?q=" + encode(terms.filter { it.isNotBlank() }.joinToString(" ")))

  fun quality(track: AstraCarTrack): String {
    val codec = track.codec.ifBlank { track.format }.trim()
    val label = if (track.isAtmosJoc || Regex("atmos|joc", RegexOption.IGNORE_CASE).containsMatchIn(track.codec + " " + track.codecProfile)) "Atmos JOC"
      else if (codec.matches(Regex("[a-zA-Z0-9._+\\-]+"))) codec.uppercase(Locale.ROOT) else codec
    val rate = if (track.sampleRate >= 1000) {
      val khz = (track.sampleRate / 100.0).roundToLong() / 10.0
      (if (khz % 1.0 == 0.0) khz.toLong().toString() else khz.toString()) + "kHz"
    } else if (track.sampleRate > 0) "${track.sampleRate}Hz" else ""
    return listOf(label, if (track.bitDepth > 0) "${track.bitDepth}-bit" else "", rate).filter { it.isNotBlank() }.joinToString(" • ")
  }

  fun decorate(activity: DiscordActivity, track: AstraCarTrack, settings: DiscordPreferences, cover: String?): DiscordActivity {
    val title = track.title.trim()
    val artist = track.artist.trim()
    val album = track.album.trim()
    val albumArtist = track.albumArtist.trim().ifBlank { artist }
    val destination = settings.linkDestination
    val detailsUrl = if (title.isEmpty()) "" else when (destination) {
      "ytmusic" -> search(title, artist)
      "lastfm" -> if (artist.isNotEmpty()) url("https://www.last.fm/music/${encode(artist)}/_/${encode(title)}") else ""
      else -> ""
    }
    val stateUrl = if (artist.isEmpty()) "" else when (destination) {
      "ytmusic" -> search(artist)
      "lastfm" -> url("https://www.last.fm/music/${encode(artist)}")
      else -> ""
    }
    val albumUrl = if (album.isEmpty()) "" else when (destination) {
      "ytmusic" -> search(album, albumArtist)
      "lastfm" -> if (albumArtist.isNotEmpty()) url("https://www.last.fm/music/${encode(albumArtist)}/${encode(album)}") else ""
      else -> ""
    }
    val image = cover?.takeIf { settings.coverArtEnabled }?.let(DiscordArtworkPolicy::publicImage)
    return activity.copy(
      statusDisplay = if (settings.compactStatusMode == "artist" && artist.isNotBlank()) 1 else 2,
      detailsUrl = detailsUrl, stateUrl = stateUrl,
      largeImage = image ?: DISCORD_ASTRA_ICON,
      largeText = DiscordPresenceController.text(if (settings.expandedInfoMode == "album") album else quality(track)),
      largeUrl = albumUrl,
      smallImage = if (image != null && settings.smallIconEnabled) DISCORD_ASTRA_ICON else "",
    )
  }
}
