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
  }
}
