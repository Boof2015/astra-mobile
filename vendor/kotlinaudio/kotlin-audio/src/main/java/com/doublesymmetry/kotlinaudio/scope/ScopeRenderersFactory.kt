package com.doublesymmetry.kotlinaudio.scope

import android.content.Context
import com.google.android.exoplayer2.DefaultRenderersFactory
import com.google.android.exoplayer2.audio.AudioProcessor
import com.google.android.exoplayer2.audio.AudioSink
import com.google.android.exoplayer2.audio.DefaultAudioSink

/**
 * A DefaultRenderersFactory whose audio sink runs the M4 processing chain.
 * Order matters:
 *   1. NormalizationGainProcessor — per-track gain (before the taps, so the
 *      scopes see normalized levels).
 *   2. ScopeTapAudioProcessor — the pre-EQ tap (post-normalization) → scope ring #1.
 *   3. EqAudioProcessor — preamp + parametric biquad chain.
 *   4. PostEqTapAudioProcessor — post-EQ tap → scope ring #2 (EQ screen overlay).
 * Float-output / playback-param capabilities are preserved by forwarding the flags.
 */
fun buildScopeRenderersFactory(context: Context): DefaultRenderersFactory =
  object : DefaultRenderersFactory(context) {
    override fun buildAudioSink(
      context: Context,
      enableFloatOutput: Boolean,
      enableAudioTrackPlaybackParams: Boolean,
      enableOffload: Boolean
    ): AudioSink =
      DefaultAudioSink.Builder(context)
        .setEnableFloatOutput(enableFloatOutput)
        .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
        .setAudioProcessors(
          arrayOf<AudioProcessor>(
            NormalizationGainProcessor(),
            ScopeTapAudioProcessor(),
            EqAudioProcessor(),
            PostEqTapAudioProcessor()
          )
        )
        .build()
  }
