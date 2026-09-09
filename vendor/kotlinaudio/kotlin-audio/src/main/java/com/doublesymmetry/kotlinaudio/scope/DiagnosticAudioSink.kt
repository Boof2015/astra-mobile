package com.doublesymmetry.kotlinaudio.scope

import com.google.android.exoplayer2.Format
import com.google.android.exoplayer2.audio.AudioSink
import com.google.android.exoplayer2.audio.DefaultAudioSink
import com.google.android.exoplayer2.audio.ForwardingAudioSink
import expo.modules.astraaudioroute.DiagnosticFormat
import expo.modules.astraaudioroute.diagnosticEncoding
import java.nio.ByteBuffer

internal inline fun observeSafely(block: () -> Unit) {
  try { block() } catch (_: Throwable) { /* Diagnostics cannot break playback. */ }
}

internal fun Format.diagnosticFormat() = DiagnosticFormat(
  sampleRate.takeIf { it > 0 }, diagnosticEncoding(pcmEncoding),
  channelCount.takeIf { it > 0 }, sampleMimeType,
)

/** Records the sink's actual chosen parameters; delegates every buffer-size decision. */
internal class DiagnosticBufferSizeProvider(
  private val delegate: DefaultAudioSink.AudioTrackBufferSizeProvider = DefaultAudioSink.AudioTrackBufferSizeProvider.DEFAULT,
) : DefaultAudioSink.AudioTrackBufferSizeProvider {
  var format: DiagnosticFormat? = null

  override fun getBufferSizeInBytes(
    minBufferSizeInBytes: Int, encoding: Int, outputMode: Int, pcmFrameSize: Int,
    sampleRate: Int, bitrate: Int, maxAudioTrackPlaybackSpeed: Double,
  ): Int {
    val size = delegate.getBufferSizeInBytes(
      minBufferSizeInBytes, encoding, outputMode, pcmFrameSize,
      sampleRate, bitrate, maxAudioTrackPlaybackSpeed,
    )
    observeSafely {
      val name = diagnosticEncoding(encoding)
      val bytes = when (name) { "pcm-8" -> 1; "pcm-16" -> 2; "pcm-24" -> 3; "pcm-32", "pcm-float" -> 4; else -> 0 }
      format = DiagnosticFormat(
        sampleRate.takeIf { it > 0 }, name,
        if (outputMode == 0 && bytes > 0 && pcmFrameSize % bytes == 0) (pcmFrameSize / bytes).takeIf { it > 0 } else null,
      )
    }
    return size
  }
}

internal interface SinkDiagnosticObserver {
  fun configure(input: DiagnosticFormat, output: DiagnosticFormat?)
  fun streamBoundary()
  fun accepted()
  fun flush(reset: Boolean)
  fun failure()
}

/** No buffer copies, new processors, altered return values, or per-buffer bridge events. */
internal class DiagnosticAudioSink(
  delegate: AudioSink,
  private val capture: DiagnosticBufferSizeProvider,
  private val observer: SinkDiagnosticObserver,
) : ForwardingAudioSink(delegate) {
  private var awaitingAcceptance = false

  override fun configure(inputFormat: Format, specifiedBufferSize: Int, outputChannels: IntArray?) {
    capture.format = null
    try {
      super.configure(inputFormat, specifiedBufferSize, outputChannels)
    } catch (error: Exception) {
      observeSafely { observer.failure() }
      throw error
    }
    awaitingAcceptance = true
    observeSafely { observer.configure(inputFormat.diagnosticFormat(), capture.format) }
  }

  override fun setOutputStreamOffsetUs(outputStreamOffsetUs: Long) {
    super.setOutputStreamOffsetUs(outputStreamOffsetUs)
    awaitingAcceptance = true
    observeSafely { observer.streamBoundary() }
  }

  override fun handleBuffer(buffer: ByteBuffer, presentationTimeUs: Long, encodedAccessUnitCount: Int): Boolean {
    val hadInput = buffer.hasRemaining()
    val accepted = try {
      super.handleBuffer(buffer, presentationTimeUs, encodedAccessUnitCount)
    } catch (error: Exception) {
      awaitingAcceptance = true
      observeSafely { observer.failure() }
      throw error
    }
    if (awaitingAcceptance && accepted && hadInput) {
      awaitingAcceptance = false
      observeSafely { observer.accepted() }
    }
    return accepted
  }

  override fun flush() {
    super.flush()
    awaitingAcceptance = true
    observeSafely { observer.flush(false) }
  }

  override fun experimentalFlushWithoutAudioTrackRelease() {
    super.experimentalFlushWithoutAudioTrackRelease()
    awaitingAcceptance = true
    observeSafely { observer.flush(false) }
  }

  override fun reset() {
    super.reset()
    awaitingAcceptance = false
    capture.format = null
    observeSafely { observer.flush(true) }
  }
}
