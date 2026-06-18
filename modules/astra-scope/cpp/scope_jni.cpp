// Plain-JNI bridge for ScopeBridge.kt. No fbjni / ReactAndroid — this library
// is pure DSP, so it only needs <jni.h> (NDK sysroot) and liblog.
//
// All JNI lives here (in the astra-scope module). The vendored kotlin-audio tap
// calls the Kotlin ScopeBridge, never JNI directly, so libastrascope.so is
// loaded exactly once.

#include <jni.h>

#include "scope_ring.h"

namespace {
astra::ScopeDriver& driver() { return astra::ScopeDriver::instance(); }
}  // namespace

extern "C" {

JNIEXPORT void JNICALL
Java_expo_modules_astrascope_ScopeBridge_nativeConfigure(
    JNIEnv* /*env*/, jobject /*thiz*/, jint sampleRate, jint channelCount) {
  driver().configure(static_cast<int>(sampleRate), static_cast<int>(channelCount));
}

// `frames` is interleaved float PCM with frameCount * channelCount elements.
JNIEXPORT void JNICALL
Java_expo_modules_astrascope_ScopeBridge_nativePushFrames(
    JNIEnv* env, jobject /*thiz*/, jfloatArray frames, jint frameCount,
    jint channelCount) {
  if (frames == nullptr || frameCount <= 0 || channelCount <= 0) {
    return;
  }
  auto* data = static_cast<float*>(
      env->GetPrimitiveArrayCritical(frames, nullptr));
  if (data == nullptr) {
    return;
  }
  driver().pushInterleaved(data, static_cast<size_t>(frameCount),
                           static_cast<int>(channelCount));
  // No JNI calls between Get/Release; abort copy-back (read-only access).
  env->ReleasePrimitiveArrayCritical(frames, data, JNI_ABORT);
}

// Fills a direct ByteBuffer (over the JS Float32Array's memory) with the latest
// spectrum (dB magnitudes), up to `capacityFloats` floats. Returns bin count.
// Zero-copy: writes straight into the JS-owned ArrayBuffer.
JNIEXPORT jint JNICALL
Java_expo_modules_astrascope_ScopeBridge_nativeFillSpectrum(
    JNIEnv* env, jobject /*thiz*/, jobject buffer, jint capacityFloats) {
  if (buffer == nullptr || capacityFloats <= 0) {
    return 0;
  }
  auto* dst = static_cast<float*>(env->GetDirectBufferAddress(buffer));
  if (dst == nullptr) {
    return 0;
  }
  const size_t n = driver().fillSpectrum(dst, static_cast<size_t>(capacityFloats));
  return static_cast<jint>(n);
}

// Fills a direct ByteBuffer (over the JS Float32Array's memory) with render-ready
// points from the latest triggered oscilloscope window. Zero-copy.
JNIEXPORT jint JNICALL
Java_expo_modules_astrascope_ScopeBridge_nativeFillOscilloscope(
    JNIEnv* env, jobject /*thiz*/, jobject buffer, jint capacityFloats) {
  if (buffer == nullptr || capacityFloats <= 0) {
    return 0;
  }
  auto* dst = static_cast<float*>(env->GetDirectBufferAddress(buffer));
  if (dst == nullptr) {
    return 0;
  }
  const size_t n = driver().fillOscilloscope(dst, static_cast<size_t>(capacityFloats));
  return static_cast<jint>(n);
}

}  // extern "C"
