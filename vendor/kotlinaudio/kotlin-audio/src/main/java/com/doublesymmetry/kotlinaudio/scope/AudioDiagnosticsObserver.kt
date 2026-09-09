package com.doublesymmetry.kotlinaudio.scope

import android.os.Handler
import com.doublesymmetry.kotlinaudio.players.components.getAudioItemHolder
import com.google.android.exoplayer2.Format
import com.google.android.exoplayer2.Timeline
import com.google.android.exoplayer2.analytics.AnalyticsListener
import com.google.android.exoplayer2.decoder.DecoderReuseEvaluation
import expo.modules.astraaudioroute.AudioDiagnosticsBridge
import expo.modules.astraaudioroute.DiagnosticFormat

class AudioDiagnosticsObserver(val generation: Long, private val handler: Handler) : AnalyticsListener {
  private val state get() = AudioDiagnosticsBridge.state

  // Renderer events and these sink observations share the application looper. Posting
  // (even on that looper) preserves the renderer's input/configure/accept ordering.
  private fun post(block: () -> Unit) {
    observeSafely { handler.post { observeSafely(block) } }
  }

  internal val sinkObserver = object : SinkDiagnosticObserver {
    override fun configure(input: DiagnosticFormat, output: DiagnosticFormat?) = post { state.configure(generation, input, output) }
    override fun streamBoundary() = post { state.streamBoundary(generation) }
    override fun accepted() = post { state.accepted(generation) }
    override fun flush(reset: Boolean) = post { state.flush(generation, reset) }
    override fun failure() = post { state.failure(generation) }
  }

  override fun onAudioInputFormatChanged(eventTime: AnalyticsListener.EventTime, format: Format, decoderReuseEvaluation: DecoderReuseEvaluation?) {
    observeSafely {
      val timeline = eventTime.timeline
      val owner = if (eventTime.windowIndex in 0 until timeline.windowCount) {
        timeline.getWindow(eventTime.windowIndex, Timeline.Window()).mediaItem.getAudioItemHolder()?.audioItem
      } else null
      state.input(generation, owner, format.diagnosticFormat())
    }
  }

  override fun onAudioDecoderInitialized(eventTime: AnalyticsListener.EventTime, decoderName: String, initializedTimestampMs: Long, initializationDurationMs: Long) {
    observeSafely { state.decoder(generation, decoderName) }
  }

  override fun onAudioDecoderReleased(eventTime: AnalyticsListener.EventTime, decoderName: String) {
    observeSafely { state.decoder(generation, null) }
  }
}
