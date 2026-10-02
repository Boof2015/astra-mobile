#include <jni.h>
#include <android/log.h>
#include <memory>
#include <string>
#include <stdexcept>
#include <vector>
#define DISCORDPP_IMPLEMENTATION
#include <discordpp.h>

namespace {
// Accessed exclusively on AstraDiscord's worker, including RunCallbacks.
std::unique_ptr<discordpp::Client> client;
std::vector<jlong> receipts;
uint64_t generation = 0;

std::string utf8(JNIEnv* env, jbyteArray bytes) {
  std::string value(env->GetArrayLength(bytes), '\0');
  env->GetByteArrayRegion(bytes, 0, value.size(), reinterpret_cast<jbyte*>(value.data()));
  return value;
}
template <typename F> void guarded(JNIEnv* env, F fn) {
  try { fn(); }
  catch (const std::exception& error) {
    __android_log_print(ANDROID_LOG_WARN, "AstraDiscord", "SDK exception: %s", error.what());
    env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), "Discord SDK operation failed");
  }
}
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_astradiscord_DiscordNative_open(JNIEnv* env, jobject, jlong applicationId) {
  guarded(env, [&] {
    ++generation;
    receipts.clear();
    client = std::make_unique<discordpp::Client>();
    client->SetApplicationId(static_cast<uint64_t>(applicationId));
    __android_log_print(ANDROID_LOG_INFO, "AstraDiscord", "RPC client initialized");
  });
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_astradiscord_DiscordNative_publish(JNIEnv* env, jobject, jlong request,
    jobjectArray fields, jlong start, jlong end, jint statusDisplay) {
  guarded(env, [&] {
    if (!client) throw std::runtime_error("No client");
    discordpp::Activity activity;
    activity.SetType(discordpp::ActivityTypes::Listening);
    activity.SetName("Astra Mobile");
    auto field = [&](jsize index) {
      auto bytes = static_cast<jbyteArray>(env->GetObjectArrayElement(fields, index));
      auto value = utf8(env, bytes);
      env->DeleteLocalRef(bytes);
      return value;
    };
    if (env->GetArrayLength(fields) != 8) throw std::runtime_error("Invalid activity");
    activity.SetStatusDisplayType(statusDisplay == 1 ? discordpp::StatusDisplayTypes::State : discordpp::StatusDisplayTypes::Details);
    activity.SetDetails(field(0));
    auto artist = field(1);
    if (!artist.empty()) activity.SetState(artist);
    const auto detailsUrl = field(2), stateUrl = field(3);
    if (!detailsUrl.empty()) activity.SetDetailsUrl(detailsUrl);
    if (!stateUrl.empty()) activity.SetStateUrl(stateUrl);
    discordpp::ActivityAssets assets;
    assets.SetLargeImage(field(4));
    const auto largeText = field(5), largeUrl = field(6), smallImage = field(7);
    if (!largeText.empty()) assets.SetLargeText(largeText);
    if (!largeUrl.empty()) assets.SetLargeUrl(largeUrl);
    if (!smallImage.empty()) {
      assets.SetSmallImage(smallImage);
      assets.SetSmallText("Astra Mobile");
      assets.SetSmallUrl("https://github.com/Boof2015/astra-mobile");
    }
    activity.SetAssets(assets);
    if (start > 0 && end > start) {
      discordpp::ActivityTimestamps timestamps;
      timestamps.SetStart(start);
      timestamps.SetEnd(end);
      activity.SetTimestamps(timestamps);
    }
    const auto epoch = generation;
    client->UpdateRichPresence(activity, [epoch, request](discordpp::ClientResult result) {
      if (epoch != generation) return;
      receipts.push_back(request);
      receipts.push_back(result.Successful() ? 1 : 0);
      __android_log_print(result.Successful() ? ANDROID_LOG_INFO : ANDROID_LOG_WARN,
        "AstraDiscord", "RPC request=%lld success=%d", static_cast<long long>(request), result.Successful());
    });
  });
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_astradiscord_DiscordNative_clear(JNIEnv* env, jobject) {
  guarded(env, [] { if (client) client->ClearRichPresence(); });
}

extern "C" JNIEXPORT jlongArray JNICALL
Java_expo_modules_astradiscord_DiscordNative_poll(JNIEnv* env, jobject) {
  guarded(env, [] { discordpp::RunCallbacks(); });
  if (env->ExceptionCheck()) return nullptr;
  auto result = env->NewLongArray(receipts.size());
  if (result) env->SetLongArrayRegion(result, 0, receipts.size(), receipts.data());
  receipts.clear();
  return result;
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_astradiscord_DiscordNative_close(JNIEnv* env, jobject) {
  guarded(env, [] { ++generation; client.reset(); receipts.clear(); });
}
