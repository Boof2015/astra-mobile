package expo.modules.astralibraryscanner.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ContainerTagsTest {
  @Test fun aSingleExplicitIdentityStillOverridesTheDisplayCredit() {
    val tags = ContainerTags(arrayOf(
      "ARTIST", "Earth, Wind & Fire feat. Guest", "ARTISTS", "Earth, Wind & Fire",
      "ALBUMARTIST", "Curator feat. Guest", "ALBUMARTISTS", "Curator",
    )).toMetadata()
    assertEquals(listOf("Earth, Wind & Fire"), tags["artistNames"])
    assertEquals(listOf("Curator"), tags["albumArtistNames"])
    assertEquals("Earth, Wind & Fire feat. Guest", tags["artist"])
  }

  @Test fun explicitArtistsOverrideDisplayCreditWithoutChangingIt() {
    val tags = ContainerTags(arrayOf(
      "ARTIST", "Earth, Wind & Fire feat. The Emotions",
      "ARTISTS", "Earth, Wind & Fire", "ARTISTS", "The Emotions",
      "ALBUM_ARTIST", "Curator & Guest", "ALBUMARTISTS", "Curator\u0000Guest",
    )).toMetadata()
    assertEquals("Earth, Wind & Fire feat. The Emotions", tags["artist"])
    assertEquals(listOf("Earth, Wind & Fire", "The Emotions"), tags["artistNames"])
    assertEquals(listOf("Curator", "Guest"), tags["albumArtistNames"])
  }

  @Test fun aliasTotalsAndFullDatesSurvive() {
    val tags = ContainerTags(arrayOf(
      "TITLE", "日本語 🛰️", "tracknumber", "02/12", "TOTALTRACKS", "13",
      "DISCNUMBER", "1/2", "DATE", "2024-11-09", "GENRE", "Electronic", "GENRE", "Ambient",
    )).toMetadata()
    assertEquals("日本語 🛰️", tags["title"])
    assertEquals(2, tags["trackNumber"])
    assertEquals(13, tags["trackTotal"])
    assertEquals(2, tags["discTotal"])
    assertEquals(2024, tags["year"])
    assertEquals("Electronic; Ambient", tags["genre"])
  }

  @Test fun missingOrInvalidValuesAreNotInvented() {
    val tags = ContainerTags(arrayOf("ARTIST", "Simon & Garfunkel", "TRACKNUMBER", "-1/no", "DISCNUMBER", "0")).toMetadata()
    assertEquals("Simon & Garfunkel", tags["artist"])
    assertEquals(emptyList<String>(), tags["artistNames"])
    assertNull(tags["trackNumber"])
    assertNull(tags["trackTotal"])
    assertNull(tags["discNumber"])
    assertNull(tags["year"])
  }
}
