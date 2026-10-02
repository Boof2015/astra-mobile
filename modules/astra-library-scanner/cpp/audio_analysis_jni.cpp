#include "audio_decoder.h"
#include <jni.h>

extern "C" JNIEXPORT jobject JNICALL
Java_expo_modules_astralibraryscanner_NativeAudioAnalyzer_analyzeDescriptor(
    JNIEnv* env, jobject, jint fd, jlong offset, jlong length, jint bins,
    jboolean loudness, jdouble durationMs, jobject cancellation, jobject progress, jlong timeoutMs) {
  const auto flagClass = env->GetObjectClass(cancellation);
  const auto getFlag = env->GetMethodID(flagClass, "get", "()Z");
  const auto progressClass = env->GetObjectClass(progress);
  const auto emit = env->GetMethodID(progressClass, "emit", "([FI)V");
  auto result = astra::analysis::decode(fd, offset, length, bins, loudness, durationMs,
    [&] { return env->CallBooleanMethod(cancellation, getFlag) == JNI_TRUE; },
    [&](const std::vector<float>& peaks, unsigned filled) {
      auto array = env->NewFloatArray(static_cast<jsize>(peaks.size()));
      if (array) {
        env->SetFloatArrayRegion(array, 0, static_cast<jsize>(peaks.size()), peaks.data());
        env->CallVoidMethod(progress, emit, array, static_cast<jint>(filled));
        env->DeleteLocalRef(array);
      }
      // Progress is best effort; final results still travel through the promise.
      if (env->ExceptionCheck()) env->ExceptionClear();
    }, timeoutMs);
  env->DeleteLocalRef(flagClass);
  env->DeleteLocalRef(progressClass);
  const auto cls = env->FindClass("expo/modules/astralibraryscanner/NativeAudioAnalysisData");
  if (!cls) return nullptr;
  auto output = env->NewObject(cls, env->GetMethodID(cls, "<init>", "()V"));
  if (!output) return nullptr;
  auto putDouble = [&](const char* name, double value) { env->SetDoubleField(output, env->GetFieldID(cls, name, "D"), value); };
  auto putInt = [&](const char* name, unsigned value) { env->SetIntField(output, env->GetFieldID(cls, name, "I"), value); };
  auto putString = [&](const char* name, const std::string& value) {
    if (value.empty()) return;
    auto text = env->NewStringUTF(value.c_str());
    env->SetObjectField(output, env->GetFieldID(cls, name, "Ljava/lang/String;"), text);
    env->DeleteLocalRef(text);
  };
  env->SetBooleanField(output, env->GetFieldID(cls, "completed", "Z"), result.completed);
  env->SetBooleanField(output, env->GetFieldID(cls, "cancelled", "Z"), result.cancelled);
  putString("error", result.error); putString("decoderName", result.decoder); putString("mime", result.mime);
  putDouble("lufs", result.lufs); putDouble("peak", result.peak);
  putDouble("durationMs", result.durationMs); putDouble("setupMs", result.setupMs);
  putDouble("firstPcmMs", result.firstPcmMs); putDouble("firstProgressMs", result.firstProgressMs);
  putDouble("decodeToEosMs", result.decodeToEosMs); putDouble("finalizeMs", result.finalizeMs);
  putDouble("decodeMs", result.decodeMs);
  putInt("sampleRate", result.sampleRate); putInt("channelCount", result.channels);
  auto peaks = env->NewFloatArray(static_cast<jsize>(result.peaks.size()));
  if (peaks && !result.peaks.empty()) env->SetFloatArrayRegion(peaks, 0, static_cast<jsize>(result.peaks.size()), result.peaks.data());
  env->SetObjectField(output, env->GetFieldID(cls, "peaks", "[F"), peaks);
  env->DeleteLocalRef(peaks);
  env->DeleteLocalRef(cls);
  return output;
}
