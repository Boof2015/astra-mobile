#pragma once

// Process-wide scope driver: a single-producer / single-consumer bridge between
// the ExoPlayer audio thread (which pushes PCM via the tap AudioProcessor) and
// the JS render thread (which pulls the latest spectrum frame once per frame).
//
// Threading contract:
//   - pushInterleaved() + configure() run on the AUDIO thread. They are
//     allocation-free and lock-free: they only touch the ring (atomic write
//     position) and an atomic pending-sample-rate. They NEVER touch the
//     analyzer (no FFT on the audio callback).
//   - fillSpectrum() runs on the single JS/render thread. It owns the analyzer
//     and all consumer-only state. It snapshots the most recent fftSize mono
//     samples from the ring and runs Visualizer::Spectrum::process there.
//
// The ring holds mono samples (the producer downmixes), sized well above the
// FFT window so a 60fps consumer never misses recent audio; on a snapshot we
// read only the most recent fftSize samples, so a slow consumer simply sees the
// latest window (correct for a rolling spectrum).

#include "spectrum.h"

#include <atomic>
#include <cstddef>
#include <cstring>
#include <vector>

namespace astra {

class ScopeDriver {
 public:
  static ScopeDriver& instance() {
    static ScopeDriver driver;
    return driver;
  }

  // Audio thread. Cheap: just remember the rate; applied on the consumer side.
  void configure(int sampleRate, int /*channelCount*/) {
    if (sampleRate > 0) {
      pendingSampleRate_.store(sampleRate, std::memory_order_release);
    }
  }

  // Audio thread. Downmix interleaved float frames to mono and write to ring.
  // Allocation-free and lock-free (single producer).
  void pushInterleaved(const float* data, size_t frames, int channels) {
    if (data == nullptr || frames == 0 || channels <= 0) {
      return;
    }
    size_t w = writePos_.load(std::memory_order_relaxed);
    const float inv = 1.0f / static_cast<float>(channels);
    for (size_t f = 0; f < frames; ++f) {
      float sum = 0.0f;
      const float* frame = data + f * channels;
      for (int c = 0; c < channels; ++c) {
        sum += frame[c];
      }
      ring_[w & kMask] = sum * inv;
      ++w;
    }
    writePos_.store(w, std::memory_order_release);
  }

  // Render thread (single consumer). Snapshot the most recent fftSize mono
  // samples, run the FFT, copy up to `cap` dB magnitudes into `out`.
  // Returns the number of bins written.
  size_t fillSpectrum(float* out, size_t cap) {
    if (out == nullptr || cap == 0) {
      return 0;
    }

    const int sr = pendingSampleRate_.load(std::memory_order_acquire);
    if (sr != appliedSampleRate_) {
      spectrum_.setSampleRate(static_cast<float>(sr));
      appliedSampleRate_ = sr;
    }

    const size_t fftSize = spectrum_.getFFTSize();
    const size_t w = writePos_.load(std::memory_order_acquire);

    const std::vector<float>* mags;
    if (w >= fftSize) {
      scratch_.resize(fftSize);
      const size_t start = w - fftSize;
      for (size_t i = 0; i < fftSize; ++i) {
        scratch_[i] = ring_[(start + i) & kMask];
      }
      mags = &spectrum_.process(scratch_.data(), fftSize);
    } else {
      // Not enough audio yet — return current (silence-initialised) frame.
      mags = &spectrum_.process(nullptr, 0);
    }

    const size_t n = std::min(cap, mags->size());
    std::memcpy(out, mags->data(), n * sizeof(float));
    return n;
  }

  size_t binCount() const { return spectrum_.getFFTSize() / 2; }

  void reset() { spectrum_.reset(); }

 private:
  ScopeDriver() : spectrum_(kFftSize) {
    spectrum_.setSmoothing(0.9f);
    ring_.assign(kSize, 0.0f);
  }

  static constexpr size_t kFftSize = 2048;  // -> 1024 dB bins
  static constexpr size_t kSize = 8192;     // ring capacity (power of two)
  static constexpr size_t kMask = kSize - 1;

  // Shared SPSC state.
  std::vector<float> ring_;
  std::atomic<size_t> writePos_{0};
  std::atomic<int> pendingSampleRate_{44100};

  // Consumer-only state.
  std::vector<float> scratch_;
  Visualizer::Spectrum spectrum_;
  int appliedSampleRate_{0};
};

}  // namespace astra
