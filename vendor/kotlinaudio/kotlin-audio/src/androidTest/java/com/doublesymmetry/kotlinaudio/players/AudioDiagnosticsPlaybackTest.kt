package com.doublesymmetry.kotlinaudio.players

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.doublesymmetry.kotlinaudio.models.DefaultAudioItem
import com.doublesymmetry.kotlinaudio.players.components.getAudioItemHolder
import com.google.android.exoplayer2.Player
import expo.modules.astraaudioroute.AudioDiagnosticsBridge
import expo.modules.astraaudioroute.DiagnosticSource
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AudioDiagnosticsPlaybackTest {
  @Test fun realDecoderAndSinkObservationsFollowRateChangesAndSameFormatReuse() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val rates = listOf(44_100, 48_000, 96_000, 48_000, 48_000)
    val depths = listOf(16, 24, 24, 16, 16)
    val files = rates.mapIndexed { index, rate ->
      val bytes = depths[index] / 8
      val size = rate * bytes // One second of silent mono PCM.
      val wav = ByteBuffer.allocate(44 + size).order(ByteOrder.LITTLE_ENDIAN)
      wav.put("RIFF".toByteArray()).putInt(36 + size).put("WAVEfmt ".toByteArray()).putInt(16)
        .putShort(1).putShort(1).putInt(rate).putInt(rate * bytes).putShort(bytes.toShort()).putShort(depths[index].toShort())
        .put("data".toByteArray()).putInt(size)
      File(context.cacheDir, "diagnostics-$index.wav").apply { writeBytes(wav.array()) }
    }
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val completed = CountDownLatch(1)
    val seen = mutableSetOf<Int>()
    val problems = mutableListOf<String>()
    val handler = Handler(Looper.getMainLooper())
    lateinit var player: QueuedAudioPlayer
    val poll = object : Runnable {
      override fun run() {
        val snapshot = AudioDiagnosticsBridge.state.snapshot()
        val source = snapshot["source"] as? Map<*, *>
        val output = snapshot["output"] as? Map<*, *>
        if (source != null && output != null && snapshot["state"] == "playing") {
          val index = source["trackId"].toString().toInt()
          seen += index
          if (source["sampleRate"] != output["sampleRate"]) problems += "Wrong output for item $index: $snapshot"
          if (output["encoding"] != "pcm-16") problems += "Default sink output changed for item $index: $snapshot"
        }
        handler.postDelayed(this, 20)
      }
    }
    instrumentation.runOnMainSync {
      player = QueuedAudioPlayer(context)
      player.volume = 0f
      player.automaticallyUpdateNotificationMetadata = false
      player.nativePlaybackObserver = { native ->
        val item = native.currentMediaItem?.getAudioItemHolder()?.audioItem
        val index = native.currentMediaItemIndex
        AudioDiagnosticsBridge.state.source(player.audioDiagnosticsGeneration, item,
          item?.let { DiagnosticSource(index.toString(), index.toString(), it.title, null, "wav", rates[index], depths[index], 1) },
          when {
            native.playerError != null -> "error"
            native.playbackState == Player.STATE_IDLE || native.playbackState == Player.STATE_ENDED -> "stopped"
            native.isPlaying -> "playing"
            native.playbackState == Player.STATE_BUFFERING -> "loading"
            else -> "paused"
          })
        if (native.playerError != null) { problems += native.playerError!!.errorCodeName; completed.countDown() }
        if (native.playbackState == Player.STATE_ENDED) completed.countDown()
      }
      player.add(files.mapIndexed { index, file -> DefaultAudioItem(file.toURI().toString(), title = "Rate $index") })
      handler.post(poll)
      player.play()
    }
    try {
      assertTrue("Timed out waiting for format transitions", completed.await(20, TimeUnit.SECONDS))
      instrumentation.runOnMainSync {
        assertTrue(problems.joinToString("\n"), problems.isEmpty())
        assertEquals("Every track must expose an accepted matching output", rates.indices.toSet(), seen)
        assertNull(AudioDiagnosticsBridge.state.snapshot()["output"])
      }
    } finally {
      instrumentation.runOnMainSync { handler.removeCallbacks(poll); player.destroy() }
      files.forEach { it.delete() }
    }
  }
}
