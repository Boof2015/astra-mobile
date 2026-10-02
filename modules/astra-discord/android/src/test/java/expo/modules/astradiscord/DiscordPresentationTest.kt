package expo.modules.astradiscord

import expo.modules.astracar.AstraCarTrack
import org.junit.Assert.*
import org.junit.Test

class DiscordPresentationTest {
  private val track = AstraCarTrack("private://server/token", "Song / 🎵", "Artist & Guest", "Album", entryId = "one", queuePosition = 0,
    albumArtist = "Album Artist", format = "flac", bitDepth = 24, sampleRate = 44100)
  private val cover = "https://is1-ssl.mzstatic.com/image/thumb/test/600x600bb.jpg"
  private fun activity(settings: DiscordPreferences = DiscordPreferences(), source: AstraCarTrack = track, image: String? = cover) =
    DiscordPresentation.decorate(DiscordActivity(source.title, source.artist), source, settings, image)

  @Test fun defaultsUsePublicLinksQualityAndTheAstraFallback() {
    val result = activity()
    assertEquals("FLAC • 24-bit • 44.1kHz", result.largeText)
    assertEquals(DISCORD_ASTRA_ICON, result.largeImage)
    assertEquals("", result.smallImage)
    assertEquals(2, result.statusDisplay)
    assertTrue(result.detailsUrl.contains("Song%20%2F%20%F0%9F%8E%B5"))
    assertFalse(result.toString().contains("private://"))
  }

  @Test fun artistModeAndLastfmLinksUseTheAlbumArtistForAlbumPages() {
    val result = activity(DiscordPreferences(compactStatusMode = "artist", expandedInfoMode = "album", linkDestination = "lastfm"))
    assertEquals(1, result.statusDisplay)
    assertEquals("Album", result.largeText)
    assertEquals("https://www.last.fm/music/Album%20Artist/Album", result.largeUrl)
    assertEquals("https://www.last.fm/music/Artist%20%26%20Guest", result.stateUrl)
    assertEquals(2, activity(DiscordPreferences(compactStatusMode = "artist"), track.copy(artist = "")).statusDisplay)
  }

  @Test fun coverAndBadgePreferencesNeverExposeLocalOrPrivateArtwork() {
    val enabled = DiscordPreferences(coverArtEnabled = true)
    assertEquals(cover, activity(enabled).largeImage)
    assertEquals(DISCORD_ASTRA_ICON, activity(enabled).smallImage)
    assertEquals("", activity(enabled.copy(smallIconEnabled = false)).smallImage)
    for (image in listOf("file:///private/cover.jpg", "https://music.example/cover?token=secret", "data:image/png;base64,abc")) {
      assertEquals(DISCORD_ASTRA_ICON, activity(enabled, image = image).largeImage)
    }
    assertEquals("", activity(DiscordPreferences(linkDestination = "off")).detailsUrl)
    assertEquals("", activity(DiscordPreferences(linkDestination = "off")).largeUrl)
  }

  @Test fun longEncodedLinksAreOmittedRatherThanBrokenAndMissingMetadataStaysEmpty() {
    val result = activity(source = track.copy(title = "🎵".repeat(100), album = "", artist = "", format = "", sampleRate = 0, bitDepth = 0))
    assertEquals("", result.detailsUrl)
    assertEquals("", result.stateUrl)
    assertEquals("", result.largeUrl)
    assertEquals("", result.largeText)
    assertEquals("Atmos JOC • 24-bit • 44.1kHz", activity(source = track.copy(codecProfile = "Dolby Atmos")).largeText)
  }

  @Test fun invalidSavedSettingsDoNotEscapeSupportedChoices() {
    val defaults = DiscordPreferences()
    assertEquals(defaults, defaults.updated(mapOf("compactStatusMode" to "bad", "pauseClearMinutes" to -5, "linkDestination" to "javascript")))
    assertEquals(0, defaults.updated(mapOf("pauseClearMinutes" to 0)).pauseClearMinutes)
  }
}
