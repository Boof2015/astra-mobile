package com.doublesymmetry.kotlinaudio.scope

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.android.exoplayer2.C
import com.google.android.exoplayer2.Format
import com.google.android.exoplayer2.audio.AudioSink
import com.google.android.exoplayer2.audio.DefaultAudioSink
import expo.modules.astraaudioroute.DiagnosticFormat
import java.lang.reflect.Proxy
import java.nio.ByteBuffer
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DiagnosticAudioSinkTest {
  private open class Observer : SinkDiagnosticObserver {
    var accepted = 0
    var failures = 0
    var output: DiagnosticFormat? = null
    override fun configure(input: DiagnosticFormat, output: DiagnosticFormat?) { this.output = output }
    override fun streamBoundary() {}
    override fun accepted() { accepted++ }
    override fun flush(reset: Boolean) {}
    override fun failure() { failures++ }
  }

  @Test fun defaultBufferSizingIsUnchangedForPcmAndEncodedOutput() {
    val capture = DiagnosticBufferSizeProvider()
    for ((encoding, mode, frameSize) in listOf(Triple(C.ENCODING_PCM_16BIT, 0, 4), Triple(C.ENCODING_PCM_FLOAT, 0, 8), Triple(C.ENCODING_AC3, 2, 1))) {
      for (rate in listOf(44_100, 48_000, 96_000)) {
        for (speed in listOf(1.0, 8.0)) {
          assertEquals(
            DefaultAudioSink.AudioTrackBufferSizeProvider.DEFAULT.getBufferSizeInBytes(4096, encoding, mode, frameSize, rate, 192_000, speed),
            capture.getBufferSizeInBytes(4096, encoding, mode, frameSize, rate, 192_000, speed),
          )
          assertEquals(rate, capture.format?.sampleRate)
          assertEquals(if (mode == 0) 2 else null, capture.format?.channels)
        }
      }
    }
  }

  @Test fun forwardsSameBufferAndWaitsForAcceptanceWithoutExtraCalls() {
    val capture = DiagnosticBufferSizeProvider()
    val observer = Observer()
    val buffer = ByteBuffer.wrap(byteArrayOf(1, 2, 3, 4))
    val calls = mutableListOf<String>()
    var writes = 0
    val delegate = Proxy.newProxyInstance(AudioSink::class.java.classLoader, arrayOf(AudioSink::class.java)) { _, method, args ->
      calls += method.name
      when (method.name) {
        "configure" -> { capture.getBufferSizeInBytes(4096, C.ENCODING_PCM_16BIT, 0, 4, 48_000, -1, 1.0); null }
        "handleBuffer" -> {
          assertSame(buffer, args!![0]); assertEquals(123L, args[1]); assertEquals(1, args[2])
          writes++
          if (writes == 1) false else { assertEquals(1.toByte(), buffer.get()); buffer.position(buffer.limit()); true }
        }
        else -> null
      }
    } as AudioSink
    val sink = DiagnosticAudioSink(delegate, capture, observer)
    sink.configure(Format.Builder().setSampleMimeType("audio/raw").setSampleRate(48_000).setChannelCount(2).setPcmEncoding(C.ENCODING_PCM_16BIT).build(), 0, null)
    assertEquals("pcm-16", observer.output?.encoding)
    assertFalse(sink.handleBuffer(buffer, 123, 1)); assertEquals(0, observer.accepted)
    assertTrue(sink.handleBuffer(buffer, 123, 1)); assertEquals(1, observer.accepted)
    assertEquals(listOf("configure", "handleBuffer", "handleBuffer"), calls)
    assertArrayEquals(byteArrayOf(1, 2, 3, 4), buffer.array())
  }

  @Test fun observerFailuresDoNotChangePlaybackAndSinkErrorsPropagateUnchanged() {
    val error = IllegalStateException("sink failure")
    var failWrite = false
    val delegate = Proxy.newProxyInstance(AudioSink::class.java.classLoader, arrayOf(AudioSink::class.java)) { _, method, _ ->
      if (method.name == "handleBuffer") { if (failWrite) throw error else true } else null
    } as AudioSink
    val observer = object : Observer() {
      override fun configure(input: DiagnosticFormat, output: DiagnosticFormat?) { error("observer failure") }
      override fun accepted() { error("observer failure") }
      override fun failure() { error("observer failure") }
    }
    val sink = DiagnosticAudioSink(delegate, DiagnosticBufferSizeProvider(), observer)
    sink.configure(Format.Builder().build(), 0, null)
    assertTrue(sink.handleBuffer(ByteBuffer.wrap(byteArrayOf(1)), 0, 1))
    failWrite = true
    try { sink.handleBuffer(ByteBuffer.wrap(byteArrayOf(1)), 0, 1); fail("Expected original exception") }
    catch (actual: IllegalStateException) { assertSame(error, actual) }
  }
}
