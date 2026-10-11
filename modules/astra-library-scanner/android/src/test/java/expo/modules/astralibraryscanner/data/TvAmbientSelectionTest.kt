package expo.modules.astralibraryscanner.data

import kotlin.random.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TvAmbientSelectionTest {
  @Test
  fun aLargeRelatedCatalogDoesNotDominateNewAmbientSessions() {
    val albums = (0 until 90).map { AmbientCandidate("related-$it", setOf("related")) } +
      listOf("favorite", "forgotten", "added", "repeat", "collection").map {
        AmbientCandidate(it, if (it == "collection") emptySet() else setOf(it))
      }
    val random = Random(42)
    val counts = (0 until 10_000).map {
      val selection = TvAmbientSelection.pick(albums, emptyList(), random)!!
      val album = albums.first { it.identityKey == selection.identityKey }
      assertTrue(selection.reason == "collection" || selection.reason in album.reasons)
      selection.reason
    }.groupingBy { it }.eachCount()

    assertTrue("Most moments should explore the collection", counts.getValue("collection") in 5_500..6_500)
    assertTrue("Related albums should be occasional, even with a large catalog", counts.getValue("related") in 500..1_100)
    for (reason in listOf("favorite", "forgotten", "added", "repeat")) {
      assertTrue("$reason must still appear", counts.getValue(reason) > 400)
    }
  }

  @Test
  fun oneAlbumCanQualifyForDifferentMomentsWithoutRelatedAlwaysWinning() {
    val album = AmbientCandidate("overlap", setOf("related", "favorite", "added", "repeat"))
    val random = Random(7)
    val reasons = (0 until 1_000).map {
      TvAmbientSelection.pick(listOf(album), emptyList(), random)!!.reason
    }.toSet()
    assertEquals(setOf("collection", "related", "favorite", "added", "repeat"), reasons)
  }

  @Test
  fun missingContextsBecomeCollectionPicksInsteadOfBoostingRelated() {
    // Also models a library with history disabled and no favorites or new additions.
    val albums = listOf(AmbientCandidate("related", setOf("related")), AmbientCandidate("other", emptySet()))
    val random = Random(5)
    val selections = (0 until 10_000).map { TvAmbientSelection.pick(albums, emptyList(), random)!! }
    assertTrue(selections.count { it.reason == "collection" } > 8_500)
    assertTrue(selections.all { it.reason == "collection" || (it.reason == "related" && it.identityKey == "related") })
    assertTrue(selections.count { it.identityKey == "other" } > 4_000)
  }

  @Test
  fun everyAlbumAppearsBeforeResetAndTheBoundaryDoesNotRepeat() {
    val albums = (0 until 12).map { AmbientCandidate("$it", if (it < 6) setOf("related") else emptySet()) }
    for (seed in 0 until 32) {
      val random = Random(seed)
      val seen = mutableListOf<String>()
      repeat(albums.size) {
        val selection = TvAmbientSelection.pick(albums, seen, random)!!
        assertFalse(selection.reset)
        assertFalse(selection.identityKey in seen)
        seen += selection.identityKey
      }
      assertEquals(albums.map { it.identityKey }.toSet(), seen.toSet())
      val next = TvAmbientSelection.pick(albums, seen, random)!!
      assertTrue(next.reset)
      assertNotEquals(seen.last(), next.identityKey)
    }
  }

  @Test
  fun exhaustedContextsAndRemovedAlbumsDoNotCauseEarlyRepeats() {
    val albums = listOf(AmbientCandidate("related", setOf("related")), AmbientCandidate("unseen", emptySet()))
    for (seed in 0 until 100) {
      val selection = TvAmbientSelection.pick(albums, listOf("removed", "related"), Random(seed))!!
      assertEquals(AmbientSelection("unseen", "collection", false), selection)
    }
  }

  @Test
  fun emptyAndSingleAlbumLibrariesStayUsable() {
    assertNull(TvAmbientSelection.pick(emptyList(), listOf("removed")))
    val single = listOf(AmbientCandidate("only", emptySet()))
    assertEquals(AmbientSelection("only", "collection", false), TvAmbientSelection.pick(single, emptyList()))
    assertEquals(AmbientSelection("only", "collection", true), TvAmbientSelection.pick(single, listOf("only")))
  }
}
