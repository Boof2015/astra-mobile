package expo.modules.astracar

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.media.session.MediaSessionManager
import android.os.Bundle
import android.os.SystemClock
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaControllerCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Log
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Opt-in: controls the installed development app and restores the selected occurrence afterward.
 * Run with -Pandroid.testInstrumentationRunnerArguments.astraCarTarget=io.github.boof2015.astra.dev
 * while the Desktop Head Unit is attached. Seeks accelerate the 20 automatic end transitions.
 */
@RunWith(AndroidJUnit4::class)
class AstraCarHostAcceptanceTest {
  @Test fun lockedPhoneTwentyAutomaticTransitionsAndClockAgreement() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val target = InstrumentationRegistry.getArguments().getString("astraCarTarget")
    assumeTrue("Set astraCarTarget to opt into controlling the development app", target?.endsWith(".dev") == true)
    val context = ApplicationProvider.getApplicationContext<Context>()
    lateinit var browser: MediaBrowserCompat
    lateinit var controller: MediaControllerCompat
    val connected = CountDownLatch(1)
    instrumentation.runOnMainSync {
      browser = MediaBrowserCompat(context, ComponentName(target!!, "expo.modules.astracar.AstraCarMediaService"),
        object : MediaBrowserCompat.ConnectionCallback() {
          override fun onConnected() { controller = MediaControllerCompat(context, browser.sessionToken); connected.countDown() }
          override fun onConnectionFailed() { connected.countDown() }
        }, Bundle().apply { putInt(AstraCarBrowseActions.LIMIT, 2) })
      browser.connect()
    }
    assertTrue("Car browser connection timed out", connected.await(20, TimeUnit.SECONDS))
    assertTrue(browser.isConnected)
    val originalId = controller.metadata?.getString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID)
    val originalPosition = controller.playbackState?.position ?: 0L
    val originalRepeat = controller.repeatMode
    val originallyPlaying = controller.playbackState?.state == PlaybackStateCompat.STATE_PLAYING
    instrumentation.uiAutomation.adoptShellPermissionIdentity(Manifest.permission.MEDIA_CONTENT_CONTROL)
    val manager = context.getSystemService(MediaSessionManager::class.java)
    fun nativeController() = manager.getActiveSessions(null).firstOrNull {
      it.packageName == target && it.metadata?.containsKey(MediaMetadataCompat.METADATA_KEY_MEDIA_ID) == false
    }
    fun waitUntil(message: String, timeout: Long = 10_000, predicate: () -> Boolean) {
      val deadline = SystemClock.elapsedRealtime() + timeout
      while (!predicate()) {
        if (SystemClock.elapsedRealtime() >= deadline) {
          Log.e("AstraCarAcceptance", "$message car=${controller.metadata?.description} carState=${controller.playbackState} native=${nativeController()?.metadata?.description} nativeState=${nativeController()?.playbackState}")
          fail(message)
        }
        SystemClock.sleep(25)
      }
    }
    try {
      val root = CountDownLatch(1)
      instrumentation.runOnMainSync {
        browser.subscribe(browser.root, object : MediaBrowserCompat.SubscriptionCallback() {
          override fun onChildrenLoaded(parentId: String, children: MutableList<MediaBrowserCompat.MediaItem>) {
            assertEquals(listOf("Home", "Library", "Playlists", "Queue"), children.map { it.description.title.toString() })
            root.countDown()
          }
        })
      }
      assertTrue(root.await(10, TimeUnit.SECONDS))
      assertEquals(2, browser.extras?.getParcelableArrayList<Bundle>(AstraCarBrowseActions.ROOT_ACTIONS)?.size)
      controller.transportControls.setRepeatMode(PlaybackStateCompat.REPEAT_MODE_ALL)
      controller.transportControls.play()
      waitUntil("Playback did not start") { controller.playbackState?.state == PlaybackStateCompat.STATE_PLAYING }
      instrumentation.uiAutomation.executeShellCommand("input keyevent 223").close()
      var worstClockDifference = 0L
      var worstMetadataDelay = 0L
      for (index in 1..20) {
        val before = controller.metadata!!
        val beforeId = before.getString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID)
        val beforeTitle = before.getString(MediaMetadataCompat.METADATA_KEY_TITLE)
        val duration = before.getLong(MediaMetadataCompat.METADATA_KEY_DURATION)
        assertTrue("Missing duration", duration > 1_000)
        Log.i("AstraCarAcceptance", "seeking transition=$index title=$beforeTitle durationMs=$duration nativeDurationMs=${nativeController()?.metadata?.getLong(MediaMetadataCompat.METADATA_KEY_DURATION)}")
        controller.transportControls.seekTo((duration - 5_000).coerceAtLeast(0))
        var nativeChangedAt = 0L
        var carChangedAt = 0L
        waitUntil("Automatic transition $index did not arrive", 20_000) {
          val now = SystemClock.elapsedRealtime()
          val native = nativeController()
          if (nativeChangedAt == 0L && native?.metadata?.getString(MediaMetadataCompat.METADATA_KEY_TITLE) != beforeTitle) nativeChangedAt = now
          if (carChangedAt == 0L && controller.metadata?.getString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID) != beforeId) carChangedAt = now
          native != null && carChangedAt > 0 && native.metadata?.getString(MediaMetadataCompat.METADATA_KEY_TITLE) == controller.metadata?.getString(MediaMetadataCompat.METADATA_KEY_TITLE)
        }
        val delay = if (nativeChangedAt > 0) (carChangedAt - nativeChangedAt).coerceAtLeast(0) else 0L
        worstMetadataDelay = maxOf(worstMetadataDelay, delay)
        assertTrue("Metadata lagged by $delay ms", delay <= 1_000)
        waitUntil("Track $index did not resume") { controller.playbackState?.state == PlaybackStateCompat.STATE_PLAYING }
        val native = nativeController()!!.playbackState!!
        val car = controller.playbackState!!
        val difference = kotlin.math.abs((car.position - native.position) +
          ((native.lastPositionUpdateTime - car.lastPositionUpdateTime) * car.playbackSpeed).toLong())
        worstClockDifference = maxOf(worstClockDifference, difference)
        assertTrue("Clock differs by $difference ms", difference <= 1_000)
        assertFalse(context.getSystemService(android.os.PowerManager::class.java).isInteractive)
        Log.i("AstraCarAcceptance", "transition=$index metadataDelayMs=$delay clockDifferenceMs=$difference")
      }
      Log.i("AstraCarAcceptance", "PASS transitions=20 worstMetadataDelayMs=$worstMetadataDelay worstClockDifferenceMs=$worstClockDifference")
    } finally {
      controller.transportControls.setRepeatMode(originalRepeat)
      if (originalId != null) {
        controller.transportControls.playFromMediaId(originalId, null)
        waitUntil("Unable to restore original queue occurrence") { controller.metadata?.getString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID) == originalId }
        controller.transportControls.seekTo(originalPosition)
      }
      if (!originallyPlaying) controller.transportControls.pause()
      instrumentation.uiAutomation.dropShellPermissionIdentity()
      instrumentation.runOnMainSync { browser.disconnect() }
    }
  }
}
