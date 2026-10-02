package expo.modules.astralibraryscanner.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackQueueOrderTest {
  private val original = (0 until 8).map { OrderedQueueItem(it.toLong(), "/music/$it.flac") }

  @Test
  fun collectionShuffleVariesTheFirstSongAcrossFixedSeeds() {
    val starts = (0L until 32L).map { seed ->
      val result = createPlaybackQueueOrder(original, null, true, seed)
      assertEquals(0, result.activePosition)
      assertSameOccurrences(original, result.entries)
      result.entries.first().entryId
    }.toSet()

    assertTrue("Collection shuffle must not pin the first song", starts.size > 1)
    assertTrue("The first song must still be eligible", original.first().entryId in starts)
  }

  @Test
  fun shuffleIsReproducibleWithoutChangingTheOriginalOrder() {
    val input = original.toMutableList()
    val first = createPlaybackQueueOrder(input, null, true, 42)
    val second = createPlaybackQueueOrder(input, null, true, 42)

    assertEquals(first, second)
    assertEquals(original, input)
  }

  @Test
  fun explicitAnchorsIncludingTheFirstSongStayFirst() {
    for (index in listOf(0, 3, original.lastIndex)) {
      val tails = (0L until 16L).map { seed ->
        val result = createPlaybackQueueOrder(original, original[index].trackPath, true, seed)
        assertEquals(original[index], result.entries.first())
        assertEquals(0, result.activePosition)
        assertSameOccurrences(original, result.entries)
        result.entries.drop(1)
      }.toSet()
      assertTrue("The remaining songs should shuffle", tails.size > 1)
    }
  }

  @Test
  fun missingAnchorShufflesTheWholeCollection() {
    for (seed in 0L until 16L) {
      assertEquals(
        createPlaybackQueueOrder(original, null, true, seed),
        createPlaybackQueueOrder(original, "/missing.flac", true, seed),
      )
    }
  }

  @Test
  fun ordinaryPlaybackPreservesOrderAndSelectsTheRequestedSong() {
    for (index in original.indices) {
      val result = createPlaybackQueueOrder(original, original[index].trackPath, false, 42)
      assertEquals(original, result.entries)
      assertEquals(index, result.activePosition)
    }
  }

  @Test
  fun ordinaryPlaybackDefaultsToTheFirstSongWithoutAValidAnchor() {
    for (anchor in listOf(null, "/missing.flac")) {
      val result = createPlaybackQueueOrder(original, anchor, false, 42)
      assertEquals(original, result.entries)
      assertEquals(0, result.activePosition)
    }
  }

  @Test
  fun duplicatePathsKeepDistinctEntryIdentities() {
    val duplicates = listOf(
      OrderedQueueItem(10, "/other.flac"),
      OrderedQueueItem(11, "/duplicate.flac"),
      OrderedQueueItem(12, "/duplicate.flac"),
      OrderedQueueItem(13, "/last.flac"),
    )
    for (anchor in listOf(null, "/duplicate.flac")) {
      for (seed in 0L until 16L) {
        val result = createPlaybackQueueOrder(duplicates, anchor, true, seed)
        assertSameOccurrences(duplicates, result.entries)
        if (anchor != null) assertEquals(duplicates[1], result.entries.first())
      }
    }
    assertEquals(1, createPlaybackQueueOrder(duplicates, "/duplicate.flac", false, 42).activePosition)
  }

  @Test
  fun emptyCollectionsRemainEmpty() {
    for (shuffle in listOf(false, true)) {
      for (anchor in listOf(null, "/missing.flac")) {
        val result = createPlaybackQueueOrder(emptyList(), anchor, shuffle, 42)
        assertTrue(result.entries.isEmpty())
        assertEquals(0, result.activePosition)
      }
    }
  }

  @Test
  fun singleSongCollectionsAlwaysStartAtTheirOnlySong() {
    val single = original.take(1)
    for (shuffle in listOf(false, true)) {
      for (anchor in listOf(null, single.first().trackPath, "/missing.flac")) {
        val result = createPlaybackQueueOrder(single, anchor, shuffle, 42)
        assertEquals(single, result.entries)
        assertEquals(0, result.activePosition)
      }
    }
  }

  private fun assertSameOccurrences(expected: List<OrderedQueueItem>, actual: List<OrderedQueueItem>) {
    assertEquals(expected.sortedBy { it.entryId }, actual.sortedBy { it.entryId })
  }
}
