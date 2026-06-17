package com.doublesymmetry.kotlinaudio.scope

import android.content.Context
import com.google.android.exoplayer2.DefaultRenderersFactory
import com.google.android.exoplayer2.audio.AudioProcessor
import com.google.android.exoplayer2.audio.AudioSink
import com.google.android.exoplayer2.audio.DefaultAudioSink

/**
 * A DefaultRenderersFactory whose audio sink runs our pre-EQ PCM tap as the
 * first (and, for M3, only) AudioProcessor. Float-output / playback-param
 * capabilities are preserved by forwarding the flags. M4 will prepend the EQ
 * AudioProcessor (and add a second post-EQ tap) to this same chain.
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
        .setAudioProcessors(arrayOf<AudioProcessor>(ScopeTapAudioProcessor()))
        .build()
  }
