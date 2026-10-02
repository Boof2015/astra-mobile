#include "audio_decoder.h"
#include "audio_analysis.h"
#define DR_FLAC_IMPLEMENTATION
#define DR_FLAC_NO_STDIO
#define DR_MP3_IMPLEMENTATION
#define DR_MP3_NO_STDIO
#define DR_WAV_IMPLEMENTATION
#define DR_WAV_NO_STDIO
#include "dr_flac.h"
#include "dr_mp3.h"
#include "dr_wav.h"

#include <algorithm>
#include <array>
#include <cerrno>
#include <chrono>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <sys/stat.h>
#include <unistd.h>

namespace astra::analysis {
namespace {
using Clock = std::chrono::steady_clock;
double elapsed(Clock::time_point start) {
  return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}
struct Source {
  int fd;
  int64_t offset, length, cursor = 0;
  const Cancelled& cancelled;
  Clock::time_point deadline;
  bool stopped = false, failed = false;
  bool check() {
    if (stopped || Clock::now() >= deadline || cancelled()) stopped = true;
    return !stopped && !failed;
  }
  size_t read(void* out, size_t requested) {
    size_t total = 0;
    if (cursor >= length) return 0;
    const auto count = std::min<uint64_t>(requested, length - cursor);
    while (total < count && check()) {
      const auto n = pread(fd, static_cast<char*>(out) + total,
                           std::min<uint64_t>(count - total, 64 * 1024), offset + cursor);
      if (n < 0 && errno == EINTR) continue;
      if (n <= 0) { failed = true; break; } // A short descriptor is not clean EOF.
      total += n; cursor += n;
    }
    return total;
  }
  bool seek(int64_t distance, int origin) {
    if (!check()) return false;
    const int64_t base = origin == 0 ? 0 : origin == 1 ? cursor : length;
    if (distance < -base || distance > length - base) return false;
    cursor = base + distance;
    return true;
  }
};
size_t readSource(void* user, void* output, size_t count) {
  return static_cast<Source*>(user)->read(output, count);
}
drflac_bool32 seekFlac(void* user, int offset, drflac_seek_origin origin) {
  return static_cast<Source*>(user)->seek(offset, static_cast<int>(origin));
}
drmp3_bool32 seekMp3(void* user, int offset, drmp3_seek_origin origin) {
  return static_cast<Source*>(user)->seek(offset, static_cast<int>(origin));
}
drwav_bool32 seekWav(void* user, int offset, drwav_seek_origin origin) {
  return static_cast<Source*>(user)->seek(offset, static_cast<int>(origin));
}
drflac_bool32 tellFlac(void* user, drflac_int64* cursor) {
  *cursor = static_cast<Source*>(user)->cursor; return DRFLAC_TRUE;
}
drmp3_bool32 tellMp3(void* user, drmp3_int64* cursor) {
  *cursor = static_cast<Source*>(user)->cursor; return DRMP3_TRUE;
}
drwav_bool32 tellWav(void* user, drwav_int64* cursor) {
  *cursor = static_cast<Source*>(user)->cursor; return DRWAV_TRUE;
}
struct Decoder {
  drflac* flac = nullptr;
  drmp3 mp3{};
  drwav wav{};
  bool hasMp3 = false, hasWav = false;
  ~Decoder() {
    if (flac) drflac_close(flac);
    if (hasMp3) drmp3_uninit(&mp3);
    if (hasWav) drwav_uninit(&wav);
  }
  uint64_t read(float* pcm, uint64_t frames) {
    if (flac) return drflac_read_pcm_frames_f32(flac, frames, pcm);
    if (hasMp3) return drmp3_read_pcm_frames_f32(&mp3, frames, pcm);
    return drwav_read_pcm_frames_f32(&wav, frames, pcm);
  }
};
}  // namespace

DecodeResult decode(int fd, int64_t offset, int64_t length, unsigned bins,
                    bool withLoudness, double durationHintMs, const Cancelled& cancelled,
                    const Progress& progress, int64_t timeoutMs) {
  DecodeResult result;
  const auto start = Clock::now();
  Source source{fd, offset, length, 0, cancelled, start + std::chrono::milliseconds(timeoutMs)};
  try {
    if (offset < 0 || timeoutMs <= 0) throw std::runtime_error("Invalid source bounds");
    if (length < 0) {
      struct stat stat{};
      if (fstat(fd, &stat) || !S_ISREG(stat.st_mode)) throw std::runtime_error("Unknown descriptor length");
      source.length = stat.st_size - offset;
    }
    if (source.length < 12 || source.length > INT64_MAX - offset) throw std::runtime_error("Invalid source length");
    std::array<unsigned char, 12> header{};
    if (source.read(header.data(), header.size()) != header.size()) throw std::runtime_error("Cannot read source");
    int64_t audioStart = 0;
    if (std::memcmp(header.data(), "ID3", 3) == 0) {
      for (int i = 6; i < 10; ++i) if (header[i] & 0x80) throw std::runtime_error("Invalid ID3 size");
      audioStart = 10 + (int64_t(header[6]) << 21) + (int64_t(header[7]) << 14) +
                   (int64_t(header[8]) << 7) + header[9];
      if (header[3] == 4 && (header[5] & 0x10)) audioStart += 10;
      if (!source.seek(audioStart, 0) || source.read(header.data(), header.size()) != header.size())
        throw std::runtime_error("Invalid ID3 extent");
    }
    Decoder decoder;
    uint64_t exactFrames = 0;
    if (!source.seek(audioStart, 0)) throw std::runtime_error("Cannot rewind source");
    if (std::memcmp(header.data(), "fLaC", 4) == 0) {
      // Normalize a possible leading ID3 block away for the FLAC callbacks.
      source.offset += audioStart; source.length -= audioStart; source.cursor = 0;
      decoder.flac = drflac_open(readSource, seekFlac, tellFlac, &source, nullptr);
      if (!decoder.flac) throw std::runtime_error("FLAC initialization failed");
      result.decoder = "dr_flac"; result.mime = "audio/flac";
      result.channels = decoder.flac->channels; result.sampleRate = decoder.flac->sampleRate;
      exactFrames = decoder.flac->totalPCMFrameCount;
    } else if ((std::memcmp(header.data(), "RIFF", 4) == 0 || std::memcmp(header.data(), "RF64", 4) == 0) &&
               std::memcmp(header.data() + 8, "WAVE", 4) == 0) {
      const uint64_t riffSize = uint64_t(header[4]) | (uint64_t(header[5]) << 8) |
                                (uint64_t(header[6]) << 16) | (uint64_t(header[7]) << 24);
      if (riffSize != UINT32_MAX && riffSize + 8 > static_cast<uint64_t>(source.length))
        throw std::runtime_error("Truncated RIFF container");
      source.seek(0, 0);
      decoder.hasWav = drwav_init(&decoder.wav, readSource, seekWav, tellWav, &source, nullptr);
      if (!decoder.hasWav) throw std::runtime_error("WAV initialization failed");
      result.decoder = "dr_wav"; result.mime = "audio/raw";
      result.channels = decoder.wav.channels; result.sampleRate = decoder.wav.sampleRate;
      exactFrames = decoder.wav.totalPCMFrameCount;
    } else if (header[0] == 0xff && (header[1] & 0xe0) == 0xe0 && (header[1] & 0x06) != 0) {
      source.seek(0, 0);
      decoder.hasMp3 = drmp3_init(&decoder.mp3, readSource, seekMp3, tellMp3, nullptr, &source, nullptr);
      if (!decoder.hasMp3) throw std::runtime_error("MP3 initialization failed");
      result.decoder = "dr_mp3"; result.mime = "audio/mpeg";
      result.channels = decoder.mp3.channels; result.sampleRate = decoder.mp3.sampleRate;
      // Calling get_pcm_frame_count on an unknown count scans the entire stream.
      if (decoder.mp3.totalPCMFrameCount != DRMP3_UINT64_MAX) {
        exactFrames = drmp3_get_pcm_frame_count(&decoder.mp3);
      }
    } else {
      throw std::runtime_error("Unsupported native container");
    }
    if (!result.channels || result.channels > 32 || result.sampleRate < 8000 || result.sampleRate > 768000)
      throw std::runtime_error("Unsupported PCM dimensions");
    uint64_t totalFrames = exactFrames;
    if (!totalFrames && std::isfinite(durationHintMs) && durationHintMs > 0 && durationHintMs < 1e12) {
      totalFrames = static_cast<uint64_t>(durationHintMs * result.sampleRate / 1000.0);
    }
    if (!totalFrames) throw std::runtime_error("Missing duration hint");
    result.durationMs = static_cast<double>(totalFrames) * 1000 / result.sampleRate;
    Accumulator accumulator(bins, totalFrames, result.channels, result.sampleRate, withLoudness);
    std::vector<float> pcm(4096 * result.channels);
    result.setupMs = elapsed(start);
    const auto decodeStart = Clock::now();
    double lastProgressMs = -80;
    unsigned lastBin = 0;
    while (source.check()) {
      const auto frames = decoder.read(pcm.data(), 4096);
      if (!frames) break;
      if (result.firstPcmMs < 0) result.firstPcmMs = elapsed(start);
      accumulator.consume(pcm.data(), frames);
      const double now = elapsed(start);
      if (accumulator.filledBins() > lastBin && now - lastProgressMs >= 80) {
        lastBin = accumulator.filledBins(); lastProgressMs = now;
        if (result.firstProgressMs < 0) result.firstProgressMs = now;
        progress(accumulator.prefix(lastBin), lastBin);
      }
    }
    result.decodeToEosMs = elapsed(decodeStart);
    if (!source.check()) throw std::runtime_error(source.stopped ? "Cancelled or timed out" : "Source read failed");
    if (!accumulator.frames() || (exactFrames && accumulator.frames() != exactFrames))
      throw std::runtime_error("Incomplete PCM stream");
    const auto difference = accumulator.frames() > totalFrames ? accumulator.frames() - totalFrames : totalFrames - accumulator.frames();
    if (!exactFrames && difference > std::max<uint64_t>(4096, totalFrames / 100))
      throw std::runtime_error("Duration hint does not match decoded stream");
    const auto finalizeStart = Clock::now();
    result.peaks = accumulator.finishPeaks();
    if (withLoudness) { result.lufs = accumulator.finishLoudness(); result.peak = accumulator.samplePeak(); }
    result.finalizeMs = elapsed(finalizeStart);
    result.completed = true;
  } catch (const std::exception& error) {
    result.error = error.what();
  } catch (...) {
    result.error = "Native analysis failed";
  }
  result.cancelled = source.stopped || cancelled() || Clock::now() >= source.deadline;
  if (result.cancelled) result.completed = false;
  if (!result.completed) { result.peaks.clear(); result.lufs = result.peak = std::numeric_limits<double>::quiet_NaN(); }
  result.decodeMs = elapsed(start);
  return result;
}
}  // namespace astra::analysis
