package expo.modules.astrascope

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Float32Array

/**
 * JS surface for the realtime scope. Both functions are synchronous (JSI):
 * [getSpectrumFrame] is pulled once per render frame from the JS thread and
 * fills a JS-preallocated Float32Array in place (no per-frame allocation, no
 * event-emitter traffic). The PCM that feeds it arrives on the audio thread via
 * the vendored kotlin-audio tap -> [ScopeBridge].
 */
class AstraScopeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AstraScope")

    // Gate the audio-thread tap (off when backgrounded/paused/reduced-motion).
    Function("setActive") { active: Boolean ->
      ScopeBridge.active = active
    }

    // Fill `out` with the latest dB spectrum; returns the number of bins written.
    Function("getSpectrumFrame") { out: Float32Array ->
      ScopeBridge.nativeFillSpectrum(out.toDirectBuffer(), out.length)
    }

    // Fill `out` with render-ready oscilloscope points (~[-1,1]).
    Function("getOscilloscopeFrame") { out: Float32Array ->
      ScopeBridge.nativeFillOscilloscope(out.toDirectBuffer(), out.length)
    }

    // --- M4: post-EQ spectrum (EQ screen overlay) ---
    // Gate the post-EQ tap (true only while the EQ screen is open).
    Function("setActivePostEq") { active: Boolean ->
      ScopeBridge.postEqActive = active
    }

    Function("getSpectrumFramePostEq") { out: Float32Array ->
      ScopeBridge.nativeFillSpectrumPostEq(out.toDirectBuffer(), out.length)
    }

    // --- M4: EQ params + per-track gain (consumed by the kotlin-audio processors) ---
    Function("setEqEnabled") { enabled: Boolean ->
      EqBridge.enabled = enabled
      EqBridge.revision += 1
    }

    Function("setEqPreamp") { linear: Double ->
      EqBridge.preampLinear = linear.toFloat()
      EqBridge.revision += 1
    }

    // Flat band params: 5 floats per band [typeOrdinal, frequency, gain, Q, enabled?1:0].
    Function("setEqBands") { params: FloatArray ->
      EqBridge.bands = params
      EqBridge.revision += 1
    }

    Function("setNormalizationGain") { linear: Double ->
      GainBridge.linearGain = linear.toFloat()
    }

    // Register a queued track's gain by URL so the player can switch to it natively at
    // the exact media-item transition (no JS round-trip on track change).
    Function("setTrackGain") { url: String, linear: Double ->
      GainBridge.putGain(url, linear.toFloat())
    }

    // Make the registered gain for this URL active now (used for the current track on
    // mount / settings change, where no transition fires).
    Function("activateTrackGain") { url: String ->
      GainBridge.activateFor(url)
    }

    Function("clearTrackGains") {
      GainBridge.clearGains()
    }
  }
}
