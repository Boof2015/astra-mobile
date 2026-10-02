#pragma once
#include <cstdint>
#include <functional>
#include <limits>
#include <string>
#include <vector>

namespace astra::analysis {
struct DecodeResult {
  bool completed = false, cancelled = false;
  std::string error, decoder, mime;
  std::vector<float> peaks;
  double lufs = std::numeric_limits<double>::quiet_NaN();
  double peak = std::numeric_limits<double>::quiet_NaN();
  double durationMs = 0, setupMs = 0, firstPcmMs = -1, firstProgressMs = -1;
  double decodeToEosMs = 0, finalizeMs = 0, decodeMs = 0;
  unsigned sampleRate = 0, channels = 0;
};
using Cancelled = std::function<bool()>;
using Progress = std::function<void(const std::vector<float>&, unsigned)>;

// Borrows fd synchronously. Read/seek callbacks are confined to [offset, offset+length).
DecodeResult decode(int fd, int64_t offset, int64_t length, unsigned bins,
                    bool withLoudness, double durationHintMs, const Cancelled& cancelled,
                    const Progress& progress, int64_t timeoutMs = 180000);
}  // namespace astra::analysis
