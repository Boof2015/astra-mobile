package expo.modules.astralibraryscanner

import android.content.ContentProvider
import android.content.ContentValues
import android.content.res.AssetFileDescriptor
import android.database.Cursor
import android.media.MediaPlayer
import android.net.Uri
import android.os.Debug
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.*
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

class AnalysisFixtureProvider : ContentProvider() {
  override fun onCreate() = true
  override fun getType(uri: Uri) = "audio/wav"
  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?): Cursor? = null
  override fun insert(uri: Uri, values: ContentValues?): Uri? = null
  override fun delete(uri: Uri, selection: String?, args: Array<out String>?) = 0
  override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?) = 0
  override fun openAssetFile(uri: Uri, mode: String): AssetFileDescriptor {
    require(mode == "r")
    val context = requireNotNull(context)
    val bytes = context.assets.open("analysis/signal.wav").use { it.readBytes() }
    if (uri.lastPathSegment == "pipe") {
      val pipe = ParcelFileDescriptor.createPipe()
      kotlin.concurrent.thread {
        runCatching { ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]).use { it.write(bytes) } }
      }
      return AssetFileDescriptor(pipe[0], 0, -1)
    }
    val file = File(context.cacheDir, "analysis-offset.wav")
    file.outputStream().use { it.write(ByteArray(127) { 0x5a }); it.write(bytes); it.write(ByteArray(97)) }
    return AssetFileDescriptor(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY), 127, bytes.size.toLong())
  }
}

@RunWith(AndroidJUnit4::class)
class AudioAnalysisTest {
  private val context get() = InstrumentationRegistry.getInstrumentation().context
  private fun fixture(name: String, directory: String = "analysis"): File = File(context.cacheDir, "analysis-${directory}-${name}").apply {
    context.assets.open("$directory/$name").use { input -> outputStream().use { input.copyTo(it) } }
  }
  private suspend fun analyze(file: File, backend: AnalysisBackend, loudness: Boolean = true, duration: Double = 1300.0) =
    AudioAnalyzer.analyze(context, Uri.fromFile(file), 512, loudness, AtomicBoolean(false), duration, backend)

  @Test fun nativeMatchesMobileAccumulatorAcrossLayoutsRatesAndChunkBoundaries() = runBlocking {
    for ((channels, rate) in listOf(1 to 44100, 2 to 48000, 6 to 96000)) {
      val frames = 62003
      val pcm = FloatArray(frames * channels) { i ->
        val frame = i / channels
        val amplitude = if (frame < frames / 2) .125 else .75
        (amplitude * sin(frame * (0.01 + (i % channels) * 0.007))).toFloat()
      }
      val file = floatWav(pcm, channels, rate)
      val result = analyze(file, AnalysisBackend.NATIVE)
      assertTrue(result.fallbackReason, result.completed)
      val reference = PlatformAudioAnalyzer.AnalyzeAccumulator(512, frames.toLong(), true).also {
        it.channelCount = channels; it.sampleRate = rate; it.pcmFloat = true
      }
      val buffer = ByteBuffer.allocate(pcm.size * 4).order(ByteOrder.LITTLE_ENDIAN)
      buffer.asFloatBuffer().put(pcm)
      reference.accumulate(buffer)
      assertArrayEquals(reference.finalPeaks(), result.peaks, 0.000001f)
      assertEquals(reference.loudness!!, result.lufs!!, 0.000001)
      assertEquals(reference.samplePeak!!, result.peak!!, 0.000001)
    }
  }

  @Test fun nativeDecodesSupportedFixturesAndRetainsWaveformOnlyMode() = runBlocking {
    for (name in listOf("signal.flac", "signal.mp3", "signal.wav", "no-xing.mp3")) {
      val result = analyze(fixture(name), AnalysisBackend.NATIVE, false)
      assertTrue("$name: ${result.fallbackReason}", result.completed)
      assertEquals(512, result.peaks.size)
      assertTrue(result.peaks.all { it.isFinite() && it in 0f..1f })
      assertNull(result.lufs); assertNull(result.peak)
      assertTrue(result.peaks.max() > .99f)
    }
  }

  @Test fun nativeAndPlatformHaveCompatibleDecodedResults() = runBlocking {
    for (name in listOf("signal.flac", "signal.mp3", "signal.wav")) {
      val file = fixture(name)
      val native = analyze(file, AnalysisBackend.NATIVE)
      val platform = analyze(file, AnalysisBackend.PLATFORM)
      assertTrue("Native $name: ${native.fallbackReason}", native.completed)
      assertTrue("Platform $name", platform.completed)
      assertEquals("$name loudness", platform.lufs!!, native.lufs!!, 0.1)
      assertEquals("$name peak", platform.peak!!, native.peak!!, 0.003)
      // dr_mp3 honors Xing/LAME delay/padding. MediaExtractor's duration can include
      // padding, shifting short-track bins; compare the native shape to its source PCM.
      val reference = if (name.endsWith("mp3")) analyze(fixture("signal.wav"), AnalysisBackend.NATIVE) else platform
      val meanDifference = native.peaks.indices.sumOf { abs(native.peaks[it] - reference.peaks[it]).toDouble() } / 512
      assertTrue("$name waveform error $meanDifference", meanDifference < .025)
    }
  }

  @Test fun descriptorOffsetAndDeclaredLengthAreRespected() = runBlocking {
    val expected = analyze(fixture("signal.wav"), AnalysisBackend.NATIVE)
    val actual = AudioAnalyzer.analyze(context,
      Uri.parse("content://expo.modules.astralibraryscanner.test.analysis/offset"),
      512, true, AtomicBoolean(false), backend = AnalysisBackend.NATIVE)
    assertTrue(actual.fallbackReason, actual.completed)
    assertArrayEquals(expected.peaks, actual.peaks, 0f)
  }

  @Test fun failuresCancellationAndTimeoutNeverProduceCacheableResults() = runBlocking {
    val file = fixture("signal.flac")
    val cancelled = AudioAnalyzer.analyze(context, Uri.fromFile(file), 512, true, AtomicBoolean(true), backend = AnalysisBackend.NATIVE)
    assertTrue(cancelled.cancelled); assertFalse(cancelled.completed); assertTrue(cancelled.peaks.isEmpty())
    val timedOut = AudioAnalyzer.analyze(context, Uri.fromFile(file), 512, true, AtomicBoolean(false), backend = AnalysisBackend.NATIVE, timeoutMs = 0)
    assertTrue(timedOut.cancelled); assertFalse(timedOut.completed)
    val bad = File(context.cacheDir, "truncated-analysis.wav").apply { writeBytes(fixture("signal.wav").readBytes().copyOf(100)) }
    for (backend in listOf(AnalysisBackend.NATIVE, AnalysisBackend.PLATFORM)) {
      assertFalse("$backend truncated", analyze(bad, backend).completed)
    }
    val flag = AtomicBoolean(false)
    val interrupted = AudioAnalyzer.analyze(context, Uri.fromFile(fixture("signal.wav")), 512, true, flag,
      backend = AnalysisBackend.NATIVE, onProgress = { _, _ -> flag.set(true) })
    assertTrue(interrupted.cancelled); assertFalse(interrupted.completed)
  }

  @Test fun unsupportedAndNonseekableSourcesUsePlatformFallback() = runBlocking {
    val unsupported = analyze(fixture("signal.m4a"), AnalysisBackend.NATIVE)
    assertFalse(unsupported.completed)
    val fallback = analyze(fixture("signal.m4a"), AnalysisBackend.AUTO)
    assertTrue(fallback.completed); assertEquals("platform", fallback.decoderRoute)
    assertEquals("Unsupported native container", fallback.fallbackReason)
    val badHint = analyze(fixture("no-xing.mp3"), AnalysisBackend.AUTO, duration = 60000.0)
    assertTrue(badHint.completed); assertEquals("platform", badHint.decoderRoute)
    assertEquals("Duration hint does not match decoded stream", badHint.fallbackReason)
    val pipe = NativeAudioAnalyzer.analyze(context,
      Uri.parse("content://expo.modules.astralibraryscanner.test.analysis/pipe"),
      512, false, 1300.0, AtomicBoolean(false), NativeAnalysisProgress { _, _ -> }, 180000)
    assertFalse(pipe.completed); assertEquals("Nonseekable source", pipe.fallbackReason)
  }

  @Test fun silenceShortFilesAndHighResolutionPcm() = runBlocking {
    for (pcm in listOf(FloatArray(18), floatArrayOf(.1250001f, -.5000001f, .0000001f))) {
      val result = analyze(floatWav(pcm, 1, 192000), AnalysisBackend.NATIVE)
      assertTrue(result.fallbackReason, result.completed)
      assertTrue(result.peaks.all { it.isFinite() })
      assertEquals(pcm.maxOf { abs(it).toDouble() }, result.peak!!, 1e-8)
      if (pcm.all { it == 0f }) assertEquals(-70.0, result.lufs!!, 0.0)
    }
  }

  /** Opt in with -e analysisBenchmark true and generated 180s assets. No app caches used. */
  @Test fun benchmarkDecoders() = runBlocking {
    assumeTrue(InstrumentationRegistry.getArguments().getString("analysisBenchmark") == "true")
    val files = listOf("signal.flac", "signal.mp3", "signal.wav").associateWith { fixture(it, "analysis-benchmark") }
    val playbackFile = fixture("signal.m4a", "analysis-benchmark")
    val player = MediaPlayer().apply { setDataSource(playbackFile.path); setVolume(0f, 0f); isLooping = true; prepare(); start() }
    val lines = mutableListOf("format,loudness,prefetch,backend,iteration,totalMs,firstFillMs,peakPssKb,pssDeltaKb,completed")
    try {
      for ((name, file) in files) for (loudness in listOf(false, true)) for (prefetch in listOf(false, true)) {
        // Warm ART/JNI once per workload; timed runs always bypass waveform/loudness caches.
        for (backend in listOf(AnalysisBackend.PLATFORM, AnalysisBackend.NATIVE)) analyze(file, backend, loudness, 180000.0)
        for (iteration in 0 until 5) for (backend in if (iteration % 2 == 0) listOf(AnalysisBackend.PLATFORM, AnalysisBackend.NATIVE) else listOf(AnalysisBackend.NATIVE, AnalysisBackend.PLATFORM)) {
          val backgroundFlag = AtomicBoolean(false)
          val background = if (prefetch) async(Dispatchers.IO) {
            AudioAnalyzer.analyze(context, Uri.fromFile(file), 512, loudness, backgroundFlag, 180000.0, backend)
          } else null
          if (prefetch) delay(20)
          val basePss = Debug.getPss()
          var peakPss = basePss
          val sampler = launch(Dispatchers.IO) { while (isActive) { peakPss = max(peakPss, Debug.getPss()); delay(10) } }
          val result = withContext(Dispatchers.IO) { analyze(file, backend, loudness, 180000.0) }
          sampler.cancelAndJoin()
          backgroundFlag.set(true); background?.await()
          val line = "$name,$loudness,$prefetch,$backend,$iteration,${result.endToEndMs},${result.firstProgressMs},$peakPss,${peakPss-basePss},${result.completed}"
          lines += line; Log.i("AstraAnalysisBenchmark", line)
          assertTrue("$name $backend ${result.fallbackReason}", result.completed)
        }
      }
    } finally {
      player.release()
      val report = File(context.getExternalFilesDir(null), "analysis-benchmark.csv")
      report.writeText(lines.joinToString("\n") + "\n")
      Log.i("AstraAnalysisBenchmark", "Report: ${report.path}")
    }
  }

  private fun floatWav(pcm: FloatArray, channels: Int, rate: Int): File {
    val buffer = ByteBuffer.allocate(44 + pcm.size * 4).order(ByteOrder.LITTLE_ENDIAN)
    buffer.put("RIFF".toByteArray()); buffer.putInt(36 + pcm.size * 4); buffer.put("WAVEfmt ".toByteArray())
    buffer.putInt(16); buffer.putShort(3); buffer.putShort(channels.toShort()); buffer.putInt(rate)
    buffer.putInt(rate * channels * 4); buffer.putShort((channels * 4).toShort()); buffer.putShort(32)
    buffer.put("data".toByteArray()); buffer.putInt(pcm.size * 4)
    for (v in pcm) buffer.putFloat(v)
    return File(context.cacheDir, "float-analysis.wav").apply { writeBytes(buffer.array()) }
  }
}
