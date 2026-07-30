// Plain-JNI bridge for ScopeBridge.kt. No fbjni / ReactAndroid — this library
// is pure DSP, so it only needs <jni.h> (NDK sysroot) and liblog.
//
// All JNI lives here (in the astra-scope module). The vendored kotlin-audio tap
// calls the Kotlin ScopeBridge, never JNI directly, so libastrascope.so is
// loaded exactly once.

#include <jni.h>

#include <algorithm>
#include <cstdint>

#include "scope_ring.h"

namespace {
astra::ScopeDriver& driver() { return astra::ScopeDriver::instance(); }

bool hasCompleteInterleavedFrames(
    JNIEnv* env, jfloatArray frames, jint frameCount, jint channelCount) {
  if (frames == nullptr || frameCount <= 0 || channelCount <= 0) {
    return false;
  }

  // Widen before multiplying so hostile or corrupted JNI arguments cannot
  // overflow and turn an undersized Java array into an out-of-bounds native read.
  const int64_t required =
      static_cast<int64_t>(frameCount) * static_cast<int64_t>(channelCount);
  return required <= static_cast<int64_t>(env->GetArrayLength(frames));
}

size_t directFloatCapacity(
    JNIEnv* env, jobject buffer, jint requestedFloats, float** address) {
  *address = nullptr;
  if (buffer == nullptr || requestedFloats <= 0) {
    return 0;
  }

  void* raw = env->GetDirectBufferAddress(buffer);
  const jlong capacityBytes = env->GetDirectBufferCapacity(buffer);
  if (raw == nullptr || capacityBytes < static_cast<jlong>(sizeof(float))) {
    return 0;
  }
  if (reinterpret_cast<uintptr_t>(raw) % alignof(float) != 0) {
    return 0;
  }

  *address = static_cast<float*>(raw);
  const size_t actualFloats =
      static_cast<size_t>(capacityBytes / static_cast<jlong>(sizeof(float)));
  return std::min(static_cast<size_t>(requestedFloats), actualFloats);
}
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
  if (!hasCompleteInterleavedFrames(env, frames, frameCount, channelCount)) {
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
    JNIEnv* env, jobject /*thiz*/, jobject buffer, jint capacityFloats,
    jfloat smoothing) {
  float* dst = nullptr;
  const size_t capacity = directFloatCapacity(env, buffer, capacityFloats, &dst);
  if (capacity == 0) {
    return 0;
  }
  const size_t n = driver().fillSpectrum(
      dst, capacity, static_cast<float>(smoothing));
  return static_cast<jint>(n);
}

// Fills a direct ByteBuffer (over the JS Float32Array's memory) with render-ready
// points from the latest triggered oscilloscope window. Zero-copy.
JNIEXPORT jint JNICALL
Java_expo_modules_astrascope_ScopeBridge_nativeFillOscilloscope(
    JNIEnv* env, jobject /*thiz*/, jobject buffer, jint capacityFloats) {
  float* dst = nullptr;
  const size_t capacity = directFloatCapacity(env, buffer, capacityFloats, &dst);
  if (capacity == 0) {
    return 0;
  }
  const size_t n = driver().fillOscilloscope(dst, capacity);
  return static_cast<jint>(n);
}

// --- POST-EQ source (M4) ----------------------------------------------------
// The post-EQ tap pushes here; the EQ screen pulls the post-EQ spectrum.

JNIEXPORT void JNICALL
Java_expo_modules_astrascope_ScopeBridge_nativePushFramesPostEq(
    JNIEnv* env, jobject /*thiz*/, jfloatArray frames, jint frameCount,
    jint channelCount) {
  if (!hasCompleteInterleavedFrames(env, frames, frameCount, channelCount)) {
    return;
  }
  auto* data = static_cast<float*>(
      env->GetPrimitiveArrayCritical(frames, nullptr));
  if (data == nullptr) {
    return;
  }
  driver().pushInterleavedPostEq(data, static_cast<size_t>(frameCount),
                                 static_cast<int>(channelCount));
  env->ReleasePrimitiveArrayCritical(frames, data, JNI_ABORT);
}

JNIEXPORT jint JNICALL
Java_expo_modules_astrascope_ScopeBridge_nativeFillSpectrumPostEq(
    JNIEnv* env, jobject /*thiz*/, jobject buffer, jint capacityFloats,
    jfloat smoothing) {
  float* dst = nullptr;
  const size_t capacity = directFloatCapacity(env, buffer, capacityFloats, &dst);
  if (capacity == 0) {
    return 0;
  }
  const size_t n = driver().fillSpectrumPostEq(
      dst, capacity, static_cast<float>(smoothing));
  return static_cast<jint>(n);
}

}  // extern "C"
