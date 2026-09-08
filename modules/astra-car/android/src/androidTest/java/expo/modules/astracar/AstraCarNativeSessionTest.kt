package expo.modules.astracar

import android.content.Context
import android.os.SystemClock
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** No React context is created. These transitions must work while JS is absent. */
@RunWith(AndroidJUnit4::class)
class AstraCarNativeSessionTest {
  @Test fun nativeTransitionsRepeatReconnectAndDelayedResults() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    InstrumentationRegistry.getInstrumentation().runOnMainSync {
      val prefs = context.getSharedPreferences("astra_car_now_playing", Context.MODE_PRIVATE)
      prefs.edit().putString("native_resume", "{\"savedAt\":1000}").commit()
      val restored = AstraCarPlaybackSnapshot(0, 0,
        AstraCarTrack("/saved.flac", "Saved", "Artist", "Album", entryId = "saved", queuePosition = 0),
        "playing", 12_000, 100_000, 1f, SystemClock.elapsedRealtime())
      AstraCarPlaybackBridge.restore(restored)
      assertEquals("paused", AstraCarPlaybackBridge.snapshot!!.state)
      assertEquals(0f, AstraCarPlaybackBridge.snapshot!!.speed)
      assertEquals(1000.0, AstraCarNowPlayingStore.resumeState(context)["savedAt"])
      val session = MediaSessionCompat(context, "car-regression")
      val presenter = AstraCarSessionPresenter(context, session)
      val generation = AstraCarPlaybackBridge.attach { _, _ -> emptyList() }
      var calls = 0
      val unsubscribe = AstraCarPlaybackBridge.subscribe {
        AstraCarPlaybackBridge.snapshot?.let {
          calls++
          presenter.apply(it, false, -1L, true, true)
        }
      }
      for (index in 1L..20L) {
        AstraCarPlaybackBridge.publish(context, AstraCarPlaybackSnapshot(generation, index,
          AstraCarTrack("/song$index.flac", "Song $index", "Artist", "Album", entryId = "$index", queuePosition = index - 1),
          "playing", 0, 100_000, 1f, SystemClock.elapsedRealtime(), queueCount = 20))
        assertEquals("Song $index", session.controller.metadata.getString(MediaMetadataCompat.METADATA_KEY_TITLE))
        assertEquals(PlaybackStateCompat.STATE_PLAYING, session.controller.playbackState.state)
      }
      val current = AstraCarPlaybackBridge.snapshot!!
      AstraCarPlaybackBridge.publish(context, current.copy(sequence = 21, positionMs = 90_000))
      AstraCarPlaybackBridge.publish(context, current.copy(sequence = 22, positionMs = 0))
      assertTrue(session.controller.playbackState.position in 0L..999L)
      AstraCarPlaybackBridge.publish(context, current.copy(sequence = 19, positionMs = 90_000))
      assertTrue(session.controller.playbackState.position in 0L..999L)
      AstraCarPlaybackBridge.refresh() // A late artwork completion must only refresh the current item.
      assertEquals("Song 20", session.controller.metadata.getString(MediaMetadataCompat.METADATA_KEY_TITLE))
      unsubscribe()
      val before = calls
      val reconnect = AstraCarPlaybackBridge.subscribe { calls++ }
      assertEquals(before + 1, calls) // Immediate replay without a playback command.
      reconnect()
      AstraCarPlaybackBridge.detach(context, generation)
      assertEquals("paused", AstraCarPlaybackBridge.snapshot!!.state)
      AstraCarPlaybackBridge.publish(context, current.copy(sequence = 999))
      assertEquals("paused", AstraCarPlaybackBridge.snapshot!!.state)
      assertEquals("paused", AstraCarNowPlayingStore.load(context).state)
      session.release()
    }
  }

  @Test fun mediaIdsDistinguishDuplicateAndReplacedOccurrencesAndPreserveAliases() {
    val first = AstraCarMediaId("queueEntry", key = "1", session = "active-context:10")
    val duplicate = first.copy(key = "2")
    val replacement = first.copy(session = "active-context:11")
    assertNotEquals(AstraCarMediaIds.encode(first), AstraCarMediaIds.encode(duplicate))
    assertNotEquals(AstraCarMediaIds.encode(first), AstraCarMediaIds.encode(replacement))
    assertEquals(first, AstraCarMediaIds.decode(AstraCarMediaIds.encode(first)))
    assertEquals("favorites", AstraCarMediaIds.decode(AstraCarMediaIds.section("favorites"))?.section)
  }
}
