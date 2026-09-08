package com.doublesymmetry.kotlinaudio.players

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.doublesymmetry.kotlinaudio.models.DefaultAudioItem
import com.doublesymmetry.kotlinaudio.players.components.getAudioItemHolder
import com.google.android.exoplayer2.Player
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativePlaybackObserverTest {
  @Test fun twentyAutomaticTransitionsPublishMatchingMetadataWithoutReact() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val file = File(context.cacheDir, "car-observer-silence.wav")
    val pcmBytes = 8_000 // 250 ms of silent mono 16-bit audio at 16 kHz.
    val wav = ByteBuffer.allocate(44 + pcmBytes).order(ByteOrder.LITTLE_ENDIAN)
    wav.put("RIFF".toByteArray()).putInt(36 + pcmBytes).put("WAVEfmt ".toByteArray()).putInt(16)
      .putShort(1).putShort(1).putInt(16_000).putInt(32_000).putShort(2).putShort(16)
      .put("data".toByteArray()).putInt(pcmBytes)
    file.writeBytes(wav.array())
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    lateinit var player: QueuedAudioPlayer
    val completed = CountDownLatch(1)
    val observed = linkedMapOf<Int, String?>()
    var error: String? = null
    instrumentation.runOnMainSync {
      player = QueuedAudioPlayer(context)
      player.volume = 0f
      player.automaticallyUpdateNotificationMetadata = false
      player.nativePlaybackObserver = { native ->
        if (native.mediaItemCount > 0) {
          val item = native.currentMediaItem!!.getAudioItemHolder().audioItem
          observed[native.currentMediaItemIndex] = item.title
          if (native.playerError != null) { error = native.playerError?.errorCodeName; completed.countDown() }
          if (native.playbackState == Player.STATE_ENDED) completed.countDown()
        }
      }
      player.add((0..20).map { DefaultAudioItem(file.toURI().toString(), title = "Song $it") })
      player.play()
    }
    try {
      assertTrue("Timed out waiting for 20 native transitions", completed.await(25, TimeUnit.SECONDS))
      assertNull(error)
      instrumentation.runOnMainSync {
        assertEquals((0..20).toList(), observed.keys.toList())
        observed.forEach { (index, title) -> assertEquals("Song $index", title) }
        assertEquals(3, player.nativeQueuePage(18, 100).size)
      }
    } finally {
      instrumentation.runOnMainSync { player.destroy(); assertNull(player.nativePlaybackObserver) }
      file.delete()
    }
  }
}
