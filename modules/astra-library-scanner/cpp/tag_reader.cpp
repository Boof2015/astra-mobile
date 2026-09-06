#include <jni.h>
#include <fileref.h>
#include <tiostream.h>
#include <tpropertymap.h>
#include <tvariant.h>
#include <flacproperties.h>
#include <wavproperties.h>
#include <aiffproperties.h>
#include <mp4properties.h>
#include <apeproperties.h>
#include <wavpackproperties.h>
#include <mpegproperties.h>
#include <opusproperties.h>
#include <vorbisproperties.h>
#include <asfproperties.h>
#include <unistd.h>
#include <sys/stat.h>
#include <algorithm>
#include <chrono>
#include <cerrno>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
using Clock = std::chrono::steady_clock;

// pread keeps each parser's cursor independent of the provider's descriptor.
// The descriptor is borrowed only for the duration of the synchronous JNI call.
class DescriptorStream final : public TagLib::IOStream {
public:
  DescriptorStream(int fd, std::string name, int64_t start, int64_t length,
                   JNIEnv *env, jobject cancelled, int timeoutMs)
    : fd_(fd), name_(std::move(name)), start_(start), length_(length),
      env_(env), cancelled_(cancelled), deadline_(Clock::now() + std::chrono::milliseconds(timeoutMs)) {
    if(length_ < 0) {
      struct stat info {};
      if(fstat(fd_, &info) != 0 || !S_ISREG(info.st_mode))
        throw std::runtime_error("Metadata stream requires a known length");
      length_ = info.st_size - start_;
    }
    if(start_ < 0 || length_ < 0) throw std::runtime_error("Invalid metadata stream bounds");
    auto cls = env_->GetObjectClass(cancelled_);
    getCancelled_ = env_->GetMethodID(cls, "get", "()Z");
    env_->DeleteLocalRef(cls);
  }
  TagLib::FileName name() const override { return name_.c_str(); }
  TagLib::ByteVector readBlock(size_t requested) override {
    check();
    const auto remaining = length_ - position_;
    const auto count = std::min<uint64_t>(requested, std::max<int64_t>(0, remaining));
    // Includes multi-page/base64 covers, while rejecting pathological allocations.
    if(count > 64 * 1024 * 1024) throw std::runtime_error("Metadata block exceeds 64 MiB");
    TagLib::ByteVector bytes(static_cast<unsigned int>(count), 0);
    size_t read = 0;
    while(read < count) {
      check();
      const auto n = pread(fd_, bytes.data() + read, std::min<uint64_t>(count - read, 256 * 1024),
                           start_ + position_ + read);
      if(n < 0) {
        if(errno == EINTR) continue;
        throw std::runtime_error(std::strerror(errno));
      }
      if(n == 0) break;
      read += n;
    }
    position_ += read;
    bytes.resize(static_cast<unsigned int>(read));
    return bytes;
  }
  bool readOnly() const override { return true; }
  bool isOpen() const override { return fd_ >= 0; }
  void seek(TagLib::offset_t offset, Position origin) override {
    check();
    const int64_t base = origin == Beginning ? 0 : origin == Current ? position_ : length_;
    // Match a regular read-only file: seeking beyond EOF is legal, and a
    // negative seek fails without moving the cursor. Several format sniffers
    // probe optional trailers beyond the bounds of small files.
    if(offset < -base || offset > std::numeric_limits<int64_t>::max() - base) return;
    position_ = base + offset;
  }
  TagLib::offset_t tell() const override { return position_; }
  TagLib::offset_t length() override { return length_; }
  void writeBlock(const TagLib::ByteVector &) override { readonly(); }
  void insert(const TagLib::ByteVector &, TagLib::offset_t, size_t) override { readonly(); }
  void removeBlock(TagLib::offset_t, size_t) override { readonly(); }
  void truncate(TagLib::offset_t) override { readonly(); }
private:
  [[noreturn]] static void readonly() { throw std::runtime_error("Read-only metadata stream"); }
  void check() {
    if(env_->CallBooleanMethod(cancelled_, getCancelled_)) throw std::runtime_error("Metadata read cancelled");
    if(Clock::now() >= deadline_) throw std::runtime_error("Metadata read timed out");
  }
  int fd_;
  std::string name_;
  int64_t start_, length_, position_ = 0;
  JNIEnv *env_;
  jobject cancelled_;
  jmethodID getCancelled_;
  Clock::time_point deadline_;
};

// JNI's NewStringUTF uses modified UTF-8 and corrupts supplementary characters.
jstring javaString(JNIEnv *env, const TagLib::String &value) {
  const auto utf16 = value.toWString();
  std::vector<jchar> chars;
  for(auto character : utf16) {
    const auto cp = static_cast<uint32_t>(character);
    if(cp <= 0xffff) chars.push_back(static_cast<jchar>(cp));
    else if(cp <= 0x10ffff) {
      chars.push_back(static_cast<jchar>(0xd800 + ((cp - 0x10000) >> 10)));
      chars.push_back(static_cast<jchar>(0xdc00 + ((cp - 0x10000) & 0x3ff)));
    }
  }
  return env->NewString(chars.data(), static_cast<jsize>(chars.size()));
}

int bitsPerSample(TagLib::AudioProperties *properties) {
  if(auto p = dynamic_cast<TagLib::FLAC::Properties *>(properties)) return p->bitsPerSample();
  if(auto p = dynamic_cast<TagLib::RIFF::WAV::Properties *>(properties)) return p->bitsPerSample();
  if(auto p = dynamic_cast<TagLib::RIFF::AIFF::Properties *>(properties)) return p->bitsPerSample();
  if(auto p = dynamic_cast<TagLib::MP4::Properties *>(properties))
    return p->codec() == TagLib::MP4::Properties::ALAC || p->codec() == TagLib::MP4::Properties::FLAC ? p->bitsPerSample() : 0;
  if(auto p = dynamic_cast<TagLib::APE::Properties *>(properties)) return p->bitsPerSample();
  if(auto p = dynamic_cast<TagLib::WavPack::Properties *>(properties)) return p->bitsPerSample();
  return 0;
}

const char *codecMime(TagLib::AudioProperties *properties) {
  if(dynamic_cast<TagLib::FLAC::Properties *>(properties)) return "audio/flac";
  if(dynamic_cast<TagLib::Ogg::Opus::Properties *>(properties)) return "audio/opus";
  if(dynamic_cast<TagLib::Ogg::Vorbis::Properties *>(properties)) return "audio/vorbis";
  if(auto p = dynamic_cast<TagLib::MPEG::Properties *>(properties)) return p->isADTS() ? "audio/aac" : "audio/mpeg";
  if(dynamic_cast<TagLib::APE::Properties *>(properties)) return "audio/ape";
  if(dynamic_cast<TagLib::WavPack::Properties *>(properties)) return "audio/wavpack";
  if(dynamic_cast<TagLib::ASF::Properties *>(properties)) return "audio/wma";
  if(auto p = dynamic_cast<TagLib::MP4::Properties *>(properties)) {
    switch(p->codec()) {
      case TagLib::MP4::Properties::AAC: return "audio/aac";
      case TagLib::MP4::Properties::ALAC: return "audio/alac";
      case TagLib::MP4::Properties::FLAC: return "audio/flac";
      case TagLib::MP4::Properties::Opus: return "audio/opus";
      case TagLib::MP4::Properties::AC3: return "audio/ac3";
      case TagLib::MP4::Properties::EAC3: return "audio/eac3";
      case TagLib::MP4::Properties::DTS: return "audio/dts";
      default: return nullptr;
    }
  }
  return nullptr;
}
}

extern "C" JNIEXPORT jobject JNICALL
Java_expo_modules_astralibraryscanner_NativeTagReader_readDescriptor(
    JNIEnv *env, jobject, jint fd, jstring name, jlong offset, jlong length,
    jobject cancelled, jint timeoutMs) {
  try {
    const auto rawName = env->GetStringUTFChars(name, nullptr);
    std::string fileName(rawName);
    env->ReleaseStringUTFChars(name, rawName);
    DescriptorStream stream(fd, fileName, offset, length, env, cancelled, timeoutMs);
    TagLib::FileRef file(&stream, true, TagLib::AudioProperties::Average);
    if(file.isNull() || !file.file()->isValid()) return nullptr;
    auto resultClass = env->FindClass("expo/modules/astralibraryscanner/NativeTagData");
    auto result = env->NewObject(resultClass, env->GetMethodID(resultClass, "<init>", "()V"));
    auto stringClass = env->FindClass("java/lang/String");
    const auto properties = file.properties();
    size_t size = 0;
    for(const auto &entry : properties) size += entry.second.size() * 2;
    if(size > 131072) throw std::runtime_error("Too many metadata values");
    auto pairs = env->NewObjectArray(static_cast<jsize>(size), stringClass, nullptr);
    int index = 0;
    for(const auto &entry : properties) {
      for(const auto &value : entry.second) {
        auto keyString = javaString(env, entry.first);
        auto valueString = javaString(env, value);
        env->SetObjectArrayElement(pairs, index++, keyString);
        env->SetObjectArrayElement(pairs, index++, valueString);
        env->DeleteLocalRef(keyString);
        env->DeleteLocalRef(valueString);
      }
    }
    env->SetObjectField(result, env->GetFieldID(resultClass, "properties", "[Ljava/lang/String;"), pairs);
    if(auto audio = file.audioProperties()) {
      auto put = [&](const char *field, int value) {
        env->SetIntField(result, env->GetFieldID(resultClass, field, "I"), value);
      };
      put("durationMs", audio->lengthInMilliseconds());
      put("bitrate", audio->bitrate() * 1000);
      put("sampleRate", audio->sampleRate());
      put("channels", audio->channels());
      put("bitsPerSample", bitsPerSample(audio));
      if(const auto mime = codecMime(audio)) {
        auto value = env->NewStringUTF(mime);
        env->SetObjectField(result, env->GetFieldID(resultClass, "codecMime", "Ljava/lang/String;"), value);
        env->DeleteLocalRef(value);
      }
    }
    // A bad cover must not invalidate already recovered text/audio properties.
    try {
      auto pictures = file.complexProperties("PICTURE");
      std::vector<TagLib::VariantMap> ranked(pictures.begin(), pictures.end());
      std::stable_sort(ranked.begin(), ranked.end(), [](const auto &a, const auto &b) {
        return (a.value("pictureType").toString() == "Front Cover") >
               (b.value("pictureType").toString() == "Front Cover");
      });
      std::vector<TagLib::ByteVector> usable;
      size_t total = 0;
      for(const auto &picture : ranked) {
        auto bytes = picture.value("data").toByteVector();
        if(bytes.isEmpty() || bytes.size() > 12 * 1024 * 1024) continue;
        if(usable.size() >= 8 || total + bytes.size() > 24 * 1024 * 1024) break;
        total += bytes.size();
        usable.push_back(std::move(bytes));
      }
      auto byteArrayClass = env->FindClass("[B");
      auto arrays = env->NewObjectArray(static_cast<jsize>(usable.size()), byteArrayClass, nullptr);
      for(size_t i = 0; i < usable.size(); ++i) {
        auto bytes = env->NewByteArray(static_cast<jsize>(usable[i].size()));
        env->SetByteArrayRegion(bytes, 0, static_cast<jsize>(usable[i].size()),
                               reinterpret_cast<const jbyte *>(usable[i].data()));
        env->SetObjectArrayElement(arrays, static_cast<jsize>(i), bytes);
        env->DeleteLocalRef(bytes);
      }
      env->SetObjectField(result, env->GetFieldID(resultClass, "pictures", "[[B"), arrays);
    } catch(const std::exception &) { /* Keep text even if artwork is malformed. */ }
    return result;
  } catch(const std::exception &error) {
    if(!env->ExceptionCheck()) env->ThrowNew(env->FindClass("java/io/IOException"), error.what());
    return nullptr;
  }
}
