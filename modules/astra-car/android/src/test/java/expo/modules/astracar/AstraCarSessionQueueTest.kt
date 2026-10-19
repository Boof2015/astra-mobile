package expo.modules.astracar

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class AstraCarSessionQueueTest {
  private fun track(index: Int, session: String? = "active-context:10") = AstraCarTrack(
    "/song$index.flac", "Song $index", "Artist", "Album", entryId = "$index",
    queuePosition = index - 1L, sessionId = session)

  private fun snapshot(index: Int, generation: Long = 1, session: String? = "active-context:10") =
    AstraCarPlaybackSnapshot(generation, index.toLong(), track(index, session), "playing", 0, 100_000, 1f, 0,
      queueCount = 250, nativeIndex = index - 1)

  private fun window(snapshot: AstraCarPlaybackSnapshot, tracks: List<AstraCarTrack> =
    (snapshot.track!!.entryId.toInt()..250).map { track(it, snapshot.track.sessionId) }) =
    AstraCarQueueWindow(AstraCarQueueIdentity.of(snapshot), tracks.take(100), 250, snapshot.track!!.queuePosition, 1)

  @Test fun closedQueueAdvancesImmediatelyFromOneToTwelveToThirteen() {
    val queue = AstraCarSessionQueue()
    val first = snapshot(1)
    queue.apply(first, window(first))
    val ids = queue.entries.associate { it.track.entryId to it.id }
    for (index in listOf(12, 13)) {
      queue.align(snapshot(index)) // No async read, browser subscription, or queue screen needed.
      assertEquals("Song $index", queue.entries.first().track.title)
      assertEquals(ids["$index"], queue.activeId)
      assertEquals((index..100).map { "$it" }, queue.entries.map { it.track.entryId })
    }
    queue.apply(snapshot(13), window(snapshot(13)))
    assertEquals(100, queue.entries.size)
    assertEquals(ids["13"], queue.activeId)
  }

  @Test fun backwardAndOutOfWindowJumpsShowCurrentItemBeforeLoading() {
    val queue = AstraCarSessionQueue()
    queue.apply(snapshot(12), window(snapshot(12)))
    for (index in listOf(3, 201)) {
      queue.align(snapshot(index))
      assertEquals(listOf("$index"), queue.entries.map { it.track.entryId })
      assertTrue(queue.activeId > 0)
      queue.apply(snapshot(index), window(snapshot(index)))
      assertEquals(minOf(100, 251 - index), queue.entries.size)
    }
  }

  @Test fun delayedWindowsCannotOverwriteRapidSkipsOrReplacementEpochs() {
    val queue = AstraCarSessionQueue()
    val old = snapshot(1)
    queue.apply(old, window(old))
    val latest = snapshot(13)
    queue.align(latest)
    assertFalse(queue.apply(latest, window(old)))
    assertEquals("13", queue.entries.first().track.entryId)
    val oldId = queue.activeId
    for (replacement in listOf(snapshot(13, session = "active-context:11"), snapshot(13, generation = 2))) {
      queue.align(replacement)
      assertFalse(queue.apply(replacement, window(latest)))
      assertEquals(1, queue.entries.size)
      assertNotEquals(oldId, queue.activeId)
    }
  }

  @Test fun duplicateSongsAndReorderingKeepOccurrenceIds() {
    val queue = AstraCarSessionQueue()
    val first = snapshot(1)
    val duplicate = track(2).copy(path = first.track!!.path, title = first.track.title)
    val tracks = listOf(first.track, duplicate, track(3))
    queue.apply(first, window(first, tracks))
    val ids = queue.entries.associate { it.track.entryId to it.id }
    assertNotEquals(ids["1"], ids["2"])
    queue.apply(first, window(first, listOf(first.track, track(3), duplicate)))
    assertEquals(listOf(ids["1"], ids["3"], ids["2"]), queue.entries.map { it.id })
    queue.align(first.copy(sequence = 2, track = duplicate))
    assertEquals(ids["2"], queue.activeId)
    assertEquals(listOf("2"), queue.entries.map { it.track.entryId })
  }

  @Test fun emptyQueueClearsActiveIdAndDoesNotReuseIds() {
    val queue = AstraCarSessionQueue()
    queue.align(snapshot(1))
    val previousId = queue.activeId
    queue.align(snapshot(1).copy(track = null, queueCount = 0))
    assertTrue(queue.entries.isEmpty())
    assertEquals(-1L, queue.activeId)
    assertEquals(0L, queue.count)
    queue.align(snapshot(1))
    assertTrue(queue.activeId > previousId)
  }

  @Test fun runtimeTeardownKeepsOnlyThePausedCardAndClearsNextAvailability() {
    val queue = AstraCarSessionQueue()
    val live = snapshot(12, session = null)
    queue.apply(live, window(live))
    val activeId = queue.activeId
    queue.align(live.copy(state = "paused", speed = 0f, queueCount = 0))
    assertEquals(listOf("12"), queue.entries.map { it.track.entryId })
    assertEquals(0L, queue.count)
    assertEquals(activeId, queue.activeId)
  }

  @Test fun unrelatedEventsCoalesceWithoutCancellingThePendingRead() = runBlocking {
    val entered = CompletableDeferred<Unit>()
    val release = CompletableDeferred<Unit>()
    var passes = 0
    val refresh = AstraCarQueueRefresh(this) {
      passes++
      if (passes == 1) { entered.complete(Unit); release.await() }
      false
    }
    val pending = refresh.request()
    entered.await()
    repeat(100) { assertSame(pending, refresh.request()) }
    assertFalse(pending.isCancelled)
    release.complete(Unit)
    pending.join()
    assertEquals(2, passes)
  }

  @Test fun delayedReadRetriesLatestOccurrenceWithoutAnotherExternalEvent() = runBlocking {
    val entered = CompletableDeferred<Unit>()
    val release = CompletableDeferred<Unit>()
    val queue = AstraCarSessionQueue()
    var live = snapshot(1)
    var passes = 0
    val refresh = AstraCarQueueRefresh(this) {
      val captured = live
      if (++passes == 1) { entered.complete(Unit); release.await() }
      !queue.apply(live, window(captured))
    }
    val pending = refresh.request()
    entered.await()
    live = snapshot(12)
    queue.align(live)
    live = snapshot(13)
    queue.align(live)
    release.complete(Unit)
    pending.join()
    assertEquals(2, passes)
    assertEquals("13", queue.entries.first().track.entryId)
    assertEquals(100, queue.entries.size)
  }
}
