package expo.modules.astracar

import org.junit.Assert.*
import org.junit.Test

class AstraCarSnapshotPolicyTest {
  private fun snapshot(generation: Long = 1, sequence: Long = 1, position: Long = 0, speed: Float = 1f) =
    AstraCarPlaybackSnapshot(generation, sequence, AstraCarTrack("song", "Title", "Artist", "Album", entryId = "entry", queuePosition = 0),
      "playing", position, 180_000, speed, 1_000)

  @Test fun automaticTransitionsDoNotNeedJavaScriptTimersOrPausePlay() {
    var current: AstraCarPlaybackSnapshot? = null
    for (index in 1L..20L) {
      val next = snapshot(sequence = index).let { it.copy(track = it.track!!.copy(path = "song$index", title = "Title $index", entryId = "entry$index")) }
      assertTrue(AstraCarSnapshotPolicy.accepts(current, next))
      current = next
      assertEquals("Title $index", current.track!!.title)
      assertEquals(1_000L, AstraCarSnapshotPolicy.position(current, 2_000))
    }
  }
  @Test fun repeatOneAndSeekCanMoveTheClockBackwardsWithoutChangingTheTrack() {
    val ending = snapshot(position = 179_000)
    val repeat = snapshot(sequence = 2)
    assertEquals(ending.track, repeat.track)
    assertTrue(AstraCarSnapshotPolicy.accepts(ending, repeat))
    assertEquals(200L, AstraCarSnapshotPolicy.position(repeat, 1_200))
    assertEquals(12_500L, AstraCarSnapshotPolicy.position(snapshot(sequence = 3, position = 12_000), 1_500))
  }
  @Test fun rapidSkipsRejectOutOfOrderResultsAndOldPlayers() {
    val current = snapshot(generation = 3, sequence = 10)
    assertFalse(AstraCarSnapshotPolicy.accepts(current, snapshot(3, 9)))
    assertFalse(AstraCarSnapshotPolicy.accepts(current, snapshot(3, 10)))
    assertFalse(AstraCarSnapshotPolicy.accepts(current, snapshot(2, 999)))
    assertTrue(AstraCarSnapshotPolicy.accepts(current, snapshot(4, 1)))
  }
  @Test fun monotonicClockHonorsSpeedBufferingPauseAndDuration() {
    assertEquals(3_000L, AstraCarSnapshotPolicy.position(snapshot(speed = 1.5f), 3_000))
    assertEquals(0L, AstraCarSnapshotPolicy.position(snapshot(), 900))
    assertEquals(180_000L, AstraCarSnapshotPolicy.position(snapshot(position = 179_000), 10_000))
    for (state in listOf("paused", "loading", "error", "stopped")) {
      assertEquals(5_000L, AstraCarSnapshotPolicy.position(snapshot(position = 5_000).copy(state = state), 9_000))
    }
  }
}
