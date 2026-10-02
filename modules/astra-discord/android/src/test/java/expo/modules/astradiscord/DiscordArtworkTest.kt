package expo.modules.astradiscord

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class DiscordArtworkTest {
  private val query = DiscordArtworkQuery("Album", "Artist", "", "Song")
  private val url = "https://is1-ssl.mzstatic.com/image/thumb/cover/600x600bb.jpg"

  @Test fun matchingAcceptsEditionSuffixesAndUnicodeButRejectsDifferentArtists() {
    val correct = DiscordCoverCandidate("Álbum (Deluxe Edition)", "Artist", url)
    val wrong = correct.copy(artist = "Unrelated")
    assertEquals(url, DiscordArtworkPolicy.choose(listOf(wrong, correct), query))
    assertNull(DiscordArtworkPolicy.choose(listOf(wrong), query))
    assertNull(DiscordArtworkPolicy.choose(listOf(correct.copy(album = "Album Live")), query))
    assertNull(DiscordArtworkPolicy.choose(listOf(correct), query.copy(artist = "", album = "Unknown album", title = "")))
  }

  @Test fun songSearchCanFindSinglesButRequiresAnArtistMatch() {
    val single = DiscordCoverCandidate("Song - Single", "Artist", url, "Song")
    assertEquals(url, DiscordArtworkPolicy.choose(listOf(single), query.copy(album = "Collection"), true))
    assertNull(DiscordArtworkPolicy.choose(listOf(single.copy(artist = "Cover Band")), query, true))
    assertEquals(listOf("Album Artist", "Artist"), DiscordArtworkPolicy.artists(query.copy(albumArtist = "Album Artist")))
  }

  @Test fun onlyKnownPublicImageHostsAreAccepted() {
    assertEquals(url, DiscordArtworkPolicy.publicImage(url.replace("https:", "http:")))
    for (value in listOf("file:///cover.jpg", "https://mzstatic.com.evil.example/art", "https://user:pass@archive.org/art", "https://127.0.0.1/art", "https://archive.org:8080/art")) {
      assertNull(DiscordArtworkPolicy.publicImage(value))
    }
  }

  @Test fun itunesHitStopsFallbackAndUsesLargerArtwork() {
    val requested = mutableListOf<String>()
    val lookup = DiscordArtworkLookup {
      requested.add(it)
      JSONObject("""{"results":[{"collectionName":"Album - EP","artistName":"Artist","artworkUrl100":"${url.replace("600x600", "100x100")}"}]}""")
    }
    assertEquals(DiscordArtworkResult("found", url, "iTunes"), lookup.resolve(query))
    assertEquals(1, requested.size)
  }

  @Test fun fallbackContinuesPastNetworkErrorsAndRejectsWrongMusicbrainzRelease() {
    val requested = mutableListOf<String>()
    val lookup = DiscordArtworkLookup {
      requested.add(it)
      when {
        it.contains("itunes.apple.com") -> throw IOException("offline")
        it.contains("musicbrainz.org") -> JSONObject("""{"releases":[{"id":"12345678-1234-1234-1234-123456789abc","title":"Album","artist-credit":[{"name":"Wrong Artist"}]}]}""")
        it.contains("theaudiodb.com") -> JSONObject("""{"album":[{"strAlbum":"Album","strArtist":"Artist","strAlbumThumb":"https://www.theaudiodb.com/images/cover.jpg"}]}""")
        else -> error("Unexpected provider $it")
      }
    }
    assertEquals("TheAudioDB", lookup.resolve(query).provider)
    assertFalse(requested.any { it.contains("coverartarchive.org") })
  }

  @Test fun coverArtArchivePrefersTheFrontThumbnail() {
    val lookup = DiscordArtworkLookup {
      when {
        it.contains("itunes.apple.com") -> JSONObject("""{"results":[]}""")
        it.contains("musicbrainz.org") -> JSONObject("""{"releases":[{"id":"12345678-1234-1234-1234-123456789abc","title":"Album","artist-credit":[{"name":"Artist"}]}]}""")
        else -> JSONObject("""{"images":[{"front":false,"image":"https://archive.org/back.jpg"},{"front":true,"image":"https://archive.org/full.jpg","thumbnails":{"500":"https://archive.org/front.jpg"}}]}""")
      }
    }
    assertEquals("https://archive.org/front.jpg", lookup.resolve(query).url)
  }

  @Test fun networkFailuresAreNotCachedAsMissesAndCacheIsBounded() {
    assertEquals("unavailable", DiscordArtworkLookup { throw IOException() }.resolve(query).state)
    assertEquals("unavailable", DiscordArtworkLookup { JSONObject("""{"results":null,"releases":null,"album":null}""") }.resolve(query).state)
    assertEquals("not-found", DiscordArtworkLookup { JSONObject("""{"results":[],"releases":[],"album":null}""") }.resolve(query).state)
    var time = 0L
    val cache = DiscordArtworkCache { time }
    cache.put(query, DiscordArtworkResult("unavailable"))
    assertTrue(cache.saved().isEmpty())
    time = 120_001
    assertNull(cache.get(query))
    cache.put(query, DiscordArtworkResult("not-found"))
    time += 86_400_001
    assertNull(cache.get(query))
    repeat(260) { cache.put(query.copy(title = "Song $it"), DiscordArtworkResult("found", url)) }
    assertEquals(256, cache.saved().size)
    cache.clear()
    assertTrue(cache.saved().isEmpty())
  }
}
