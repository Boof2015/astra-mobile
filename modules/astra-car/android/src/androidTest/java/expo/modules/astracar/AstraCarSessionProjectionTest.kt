package expo.modules.astracar

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaControllerCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class AstraCarSessionProjectionTest {
  private fun track(index: Int) = AstraCarTrack("/song$index.flac", "Song $index", "Artist", "Album",
    entryId = "$index", queuePosition = index - 1L)

  @Test fun closedQueueAndLateControllerSeeCurrentOccurrenceWithoutBrowseSubscriptions() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    lateinit var session: MediaSessionCompat
    lateinit var projection: AstraCarSessionProjection
    lateinit var controller: MediaControllerCompat
    val tracks = (1..250).map(::track)
    fun snapshot(index: Int) = AstraCarPlaybackSnapshot(1, index.toLong(), tracks[index - 1], "playing",
      0, 100_000, 1f, SystemClock.elapsedRealtime(), queueCount = tracks.size, nativeIndex = index - 1)
    fun assertCurrent(index: Int) {
      val items = controller.queue!!
      val active = items.first()
      assertEquals("Song $index", active.description.title)
      assertEquals(active.queueId, controller.playbackState!!.activeQueueItemId)
      assertEquals(active.description.mediaId, controller.metadata!!.getString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID))
      assertEquals(active.description.mediaId, projection.target(active.queueId))
      assertTrue(items.size <= 100)
    }
    instrumentation.runOnMainSync {
      session = MediaSessionCompat(context, "queue-regression")
      projection = AstraCarSessionProjection(context, session)
    }
    try {
      instrumentation.runOnMainSync {
        val first = snapshot(1)
        projection.queue.apply(first, AstraCarQueueWindow(AstraCarQueueIdentity.of(first), tracks.take(100), 250, 0))
        projection.render(first, false)
        projection.render(snapshot(12), false)
        // Simulate opening the queue for the first time: no callback or browse subscription existed.
        controller = MediaControllerCompat(context, session.sessionToken)
        assertCurrent(12)
      }
      val advanced = CountDownLatch(1)
      val callback = object : MediaControllerCompat.Callback() {
        override fun onPlaybackStateChanged(state: PlaybackStateCompat?) {
          if (controller.queue?.firstOrNull()?.description?.title == "Song 13" &&
            state?.activeQueueItemId == controller.queue?.firstOrNull()?.queueId) advanced.countDown()
        }
      }
      controller.registerCallback(callback, Handler(Looper.getMainLooper()))
      instrumentation.runOnMainSync { projection.render(snapshot(13), false); assertCurrent(13) }
      assertTrue("Open controller did not receive the transition", advanced.await(5, TimeUnit.SECONDS))
      controller.unregisterCallback(callback)
      instrumentation.runOnMainSync {
        // Close, advance beyond the cached window, and reopen without waiting for Room.
        projection.render(snapshot(201), false)
        controller = MediaControllerCompat(context, session.sessionToken)
        assertCurrent(201)
        assertEquals(1, controller.queue!!.size)
        projection.render(snapshot(3), false)
        assertCurrent(3)
        projection.render(snapshot(3).copy(track = null, queueCount = 0), false)
        assertTrue(controller.queue!!.isEmpty())
        assertEquals(-1L, controller.playbackState!!.activeQueueItemId)
      }
    } finally { instrumentation.runOnMainSync { session.release() } }
  }

  @Test fun runtimeWindowRejectsReordersAndPlayerReplacementButAcceptsClockUpdates() = runBlocking {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val reader = AstraCarQueue(context)
    var tracks = (1..20).map(::track)
    var generation = 0L
    lateinit var snapshot: AstraCarPlaybackSnapshot
    instrumentation.runOnMainSync {
      generation = AstraCarPlaybackBridge.attach { offset, limit -> tracks.drop(offset).take(limit) }
      snapshot = AstraCarPlaybackSnapshot(generation, 1, tracks[11], "playing", 0, 100_000, 1f,
        SystemClock.elapsedRealtime(), queueCount = tracks.size, nativeIndex = 11)
      AstraCarPlaybackBridge.publish(context, snapshot)
    }
    try {
      val window = reader.sessionWindow(snapshot)!!
      assertEquals("12", window.tracks.first().entryId)
      instrumentation.runOnMainSync { AstraCarPlaybackBridge.publish(context, snapshot.copy(sequence = 2, positionMs = 5000)) }
      assertTrue(reader.isSessionWindowCurrent(window))
      instrumentation.runOnMainSync { tracks = tracks.take(12) + tracks.drop(12).reversed() }
      assertFalse(reader.isSessionWindowCurrent(window))
      val reordered = reader.sessionWindow(snapshot)!!
      assertEquals(listOf("12", "20", "19"), reordered.tracks.take(3).map { it.entryId })
      instrumentation.runOnMainSync {
        AstraCarPlaybackBridge.detach(context, generation)
        generation = AstraCarPlaybackBridge.attach { offset, limit -> tracks.drop(offset).take(limit) }
        AstraCarPlaybackBridge.publish(context, snapshot.copy(generation = generation, sequence = 1))
      }
      assertFalse(reader.isSessionWindowCurrent(reordered))
      assertNull(reader.sessionWindow(snapshot))
    } finally { instrumentation.runOnMainSync { AstraCarPlaybackBridge.detach(context, generation) } }
  }
}
