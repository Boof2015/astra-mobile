package expo.modules.astralibraryscanner.data

import org.junit.Assert.assertEquals
import org.junit.Test

class ArtistCreditsTest {
  @Test
  fun repeatedVorbisCreditsPreserveOrderAndPunctuation() {
    val collector = ArtistCreditCollector()
    collector.consider("ARTIST", " Earth, Wind & Fire ")
    collector.consider("artist", "The Emotions")
    collector.consider("ALBUMARTIST", "Curator One")
    collector.consider("album_artist", "Curator Two")

    val credits = collector.build()

    assertEquals(listOf("Earth, Wind & Fire", "The Emotions"), credits.artists)
    assertEquals(listOf("Curator One", "Curator Two"), credits.albumArtists)
    assertEquals("Earth, Wind & Fire, The Emotions", formatArtistNames(credits.artists))
    assertEquals("Curator One, Curator Two", formatArtistNames(credits.albumArtists))
    assertEquals("1, 2, 3", formatArtistNames(listOf("1", "2", "3")))
  }

  @Test
  fun duplicateCreditsAreRemovedCaseInsensitivelyWithoutReordering() {
    val collector = ArtistCreditCollector()
    collector.consider("TPE1", "Artist One")
    collector.consider("ARTIST", " artist   one ")
    collector.consider("ARTISTS", "Artist Two")
    collector.consider("TPE2", "Album Artist\u0000Guest Curator")

    val credits = collector.build()

    assertEquals(listOf("Artist Two"), credits.artists)
    assertEquals(listOf("Album Artist", "Guest Curator"), credits.albumArtists)
  }

  @Test
  fun unrelatedOrMissingMetadataProducesEmptyCredits() {
    val collector = ArtistCreditCollector()
    collector.consider("TITLE", "Song")
    collector.consider(null, "Artist")
    collector.consider("ARTIST", null)

    assertEquals(ArtistCreditNames(), collector.build())
  }

}
