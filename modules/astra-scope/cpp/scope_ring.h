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

#include "oscilloscope.h"
#include "spectrum.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
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
  size_t fillSpectrum(float* out, size_t cap, float smoothing) {
    if (out == nullptr || cap == 0) {
      return 0;
    }

    spectrum_.setSmoothing(smoothing);

    const int sr = pendingSampleRate_.load(std::memory_order_acquire);
    if (sr != appliedSampleRate_) {
      spectrum_.setSampleRate(static_cast<float>(sr));
      appliedSampleRate_ = sr;
    }

    const size_t fftSize = spectrum_.getFFTSize();
    const size_t w = writePos_.load(std::memory_order_acquire);
    const size_t sampleRate = sr > 0 ? static_cast<size_t>(sr) : static_cast<size_t>(48000);
    const size_t delaySamples = scopeOutputDelaySamples(sampleRate);
    const size_t readHead = w > delaySamples ? w - delaySamples : 0;

    const std::vector<float>* mags;
    if (readHead >= fftSize) {
      scratch_.resize(fftSize);
      const size_t start = readHead - fftSize;
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

  // Render thread (single consumer). Unlike the spectrum (which snapshots the
  // latest window), the oscilloscope needs CONTINUOUS samples for a stable
  // pitch-locked trigger. We drain a bounded recent slice into its internal
  // circular buffer, then return render-ready points from the triggered window.
  size_t fillOscilloscope(float* out, size_t cap) {
    if (out == nullptr || cap == 0) {
      return 0;
    }

    const int sr = pendingSampleRate_.load(std::memory_order_acquire);
    if (sr != oscAppliedSampleRate_) {
      osc_.setSampleRate(static_cast<float>(sr));
      oscDisplaySamples_ = normalizedDisplaySamples(sr);
      osc_.setDisplaySamples(static_cast<int>(oscDisplaySamples_));
      oscAppliedSampleRate_ = sr;
      oscLastDrainTime_ = {};
      oscDrainCarrySamples_ = 0.0;
    }

    const size_t w = writePos_.load(std::memory_order_acquire);

    if (w < kOscWarmupSamples) {
      return 0;
    }

    const size_t sampleRate = sr > 0 ? static_cast<size_t>(sr) : static_cast<size_t>(48000);
    const size_t outputDelaySamples = scopeOutputDelaySamples(sampleRate);
    size_t available = w - oscReadPos_;
    const size_t staleResetSamples = std::max(kSize, sampleRate / 4);
    const auto now = std::chrono::steady_clock::now();

    if (available > kSize || available >= staleResetSamples) {
      osc_.reset();
      oscSamplesSeen_ = 0;
      oscLastDrainTime_ = now;
      oscDrainCarrySamples_ = 0.0;
      const size_t retained = std::min({w, kSize, kOscRetainedBacklogSamples});
      oscReadPos_ = w - retained;
      available = retained;
    } else if (available > kOscRetainedBacklogSamples) {
      oscReadPos_ = w - kOscRetainedBacklogSamples;
      available = kOscRetainedBacklogSamples;
      oscDrainCarrySamples_ = 0.0;
    }

    const size_t drainable = available > outputDelaySamples ? available - outputDelaySamples : 0;
    size_t drainBudget = oscDrainBudget(now, sampleRate, drainable);
    const size_t warmup = std::max(kOscWarmupSamples, oscDisplaySamples_);
    if (oscSamplesSeen_ < warmup) {
      drainBudget = std::max(drainBudget, std::min(drainable, warmup - oscSamplesSeen_));
    }

    const size_t drainEnd = oscReadPos_ + std::min(drainable, drainBudget);
    while (oscReadPos_ < drainEnd) {
      const size_t idx = oscReadPos_ & kMask;
      const size_t chunk = std::min(drainEnd - oscReadPos_, kSize - idx);
      osc_.pushSamples(&ring_[idx], chunk);
      oscReadPos_ += chunk;
      oscSamplesSeen_ += chunk;
    }

    if (oscSamplesSeen_ < warmup) {
      return 0;
    }

    const Visualizer::OscilloscopeResult r = osc_.process();
    if (r.samplesToShow <= 1) {
      return 0;
    }

    const size_t count = std::min(cap, static_cast<size_t>(r.samplesToShow));
    if (count < 2) {
      return 0;
    }

    const float step = static_cast<float>(r.samplesToShow - 1) /
                       static_cast<float>(count - 1);
    osc_.getSamplesInterpolated(out, r.triggerIndex, count, step);
    return count;
  }

  // ---- POST-EQ source (M4) -------------------------------------------------
  // A second, spectrum-only SPSC source fed by the post-EQ tap. Mirrors the
  // pre-EQ spectrum path exactly; used only by the EQ screen's response-curve
  // overlay, so there is no post-EQ oscilloscope.

  // Audio thread. Downmix interleaved float frames to mono into the post-EQ ring.
  void pushInterleavedPostEq(const float* data, size_t frames, int channels) {
    if (data == nullptr || frames == 0 || channels <= 0) {
      return;
    }
    size_t w = postEqWritePos_.load(std::memory_order_relaxed);
    const float inv = 1.0f / static_cast<float>(channels);
    for (size_t f = 0; f < frames; ++f) {
      float sum = 0.0f;
      const float* frame = data + f * channels;
      for (int c = 0; c < channels; ++c) {
        sum += frame[c];
      }
      postEqRing_[w & kMask] = sum * inv;
      ++w;
    }
    postEqWritePos_.store(w, std::memory_order_release);
  }

  // Render thread. Latest post-EQ spectrum window -> `out` (dB magnitudes).
  size_t fillSpectrumPostEq(float* out, size_t cap, float smoothing) {
    if (out == nullptr || cap == 0) {
      return 0;
    }

    postEqSpectrum_.setSmoothing(smoothing);

    const int sr = pendingSampleRate_.load(std::memory_order_acquire);
    if (sr != postEqAppliedSampleRate_) {
      postEqSpectrum_.setSampleRate(static_cast<float>(sr));
      postEqAppliedSampleRate_ = sr;
    }

    const size_t fftSize = postEqSpectrum_.getFFTSize();
    const size_t w = postEqWritePos_.load(std::memory_order_acquire);
    const size_t sampleRate = sr > 0 ? static_cast<size_t>(sr) : static_cast<size_t>(48000);
    const size_t delaySamples = scopeOutputDelaySamples(sampleRate);
    const size_t readHead = w > delaySamples ? w - delaySamples : 0;

    const std::vector<float>* mags;
    if (readHead >= fftSize) {
      postEqScratch_.resize(fftSize);
      const size_t start = readHead - fftSize;
      for (size_t i = 0; i < fftSize; ++i) {
        postEqScratch_[i] = postEqRing_[(start + i) & kMask];
      }
      mags = &postEqSpectrum_.process(postEqScratch_.data(), fftSize);
    } else {
      mags = &postEqSpectrum_.process(nullptr, 0);
    }

    const size_t n = std::min(cap, mags->size());
    std::memcpy(out, mags->data(), n * sizeof(float));
    return n;
  }

  size_t binCount() const { return spectrum_.getFFTSize() / 2; }

  void reset() {
    spectrum_.reset();
    postEqSpectrum_.reset();
    osc_.reset();
    oscReadPos_ = writePos_.load(std::memory_order_acquire);
    oscSamplesSeen_ = 0;
    oscLastDrainTime_ = {};
    oscDrainCarrySamples_ = 0.0;
  }

 private:
  ScopeDriver() : spectrum_(kFftSize), postEqSpectrum_(kFftSize) {
    spectrum_.setSmoothing(0.92f);
    postEqSpectrum_.setSmoothing(0.92f);
    ring_.assign(kSize, 0.0f);
    postEqRing_.assign(kSize, 0.0f);
  }

  static constexpr size_t kFftSize = 2048;  // -> 1024 dB bins
  static constexpr size_t kSize = 16384;    // ring capacity (power of two)
  static constexpr size_t kMask = kSize - 1;
  static constexpr size_t kOscWarmupSamples = 4096;
  static constexpr size_t kOscRetainedBacklogSamples = kSize;
  static constexpr size_t kOscMinFrameDrainSamples = 128;
  static constexpr size_t kOscMaxFrameDrainSamples = 2048;
  static constexpr double kScopeOutputDelaySeconds = 0.12;

  static size_t normalizedDisplaySamples(int sampleRate) {
    constexpr double base = 2048.0;
    constexpr double rateMin = 44100.0;
    constexpr double rateMax = 48000.0;
    const double safeRate = sampleRate > 0 ? static_cast<double>(sampleRate) : rateMax;

    double samples = base;
    if (safeRate < rateMin) {
      samples = base * (safeRate / rateMin);
    } else if (safeRate > rateMax) {
      samples = base * (safeRate / rateMax);
    }

    return static_cast<size_t>(std::clamp(std::round(samples), 64.0, 32767.0));
  }

  static size_t scopeOutputDelaySamples(size_t sampleRate) {
    const double samples = static_cast<double>(sampleRate) * kScopeOutputDelaySeconds;
    return static_cast<size_t>(std::clamp(
        std::round(samples),
        0.0,
        static_cast<double>(kOscRetainedBacklogSamples / 2)));
  }

  size_t oscDrainBudget(
      std::chrono::steady_clock::time_point now,
      size_t sampleRate,
      size_t available) {
    if (available == 0) {
      oscLastDrainTime_ = now;
      oscDrainCarrySamples_ = 0.0;
      return 0;
    }

    double elapsedSeconds = 1.0 / 60.0;
    if (oscLastDrainTime_.time_since_epoch().count() != 0) {
      elapsedSeconds = std::chrono::duration<double>(now - oscLastDrainTime_).count();
      elapsedSeconds = std::clamp(elapsedSeconds, 0.0, 0.1);
    }
    oscLastDrainTime_ = now;

    double desired = elapsedSeconds * static_cast<double>(sampleRate) + oscDrainCarrySamples_;
    size_t budget = static_cast<size_t>(std::floor(desired));
    oscDrainCarrySamples_ = desired - static_cast<double>(budget);

    if (budget < kOscMinFrameDrainSamples) {
      budget = std::min(kOscMinFrameDrainSamples, available);
      oscDrainCarrySamples_ = 0.0;
    }

    const size_t drain = std::min({available, budget, kOscMaxFrameDrainSamples});
    if (drain >= available) {
      oscDrainCarrySamples_ = 0.0;
    }
    return drain;
  }

  // Shared SPSC state.
  std::vector<float> ring_;
  std::atomic<size_t> writePos_{0};
  std::atomic<int> pendingSampleRate_{44100};

  // Consumer-only state.
  std::vector<float> scratch_;
  Visualizer::Spectrum spectrum_;
  int appliedSampleRate_{0};

  // Post-EQ source (M4) — second SPSC ring + spectrum-only analyzer.
  std::vector<float> postEqRing_;
  std::atomic<size_t> postEqWritePos_{0};
  std::vector<float> postEqScratch_;
  Visualizer::Spectrum postEqSpectrum_;
  int postEqAppliedSampleRate_{0};

  Visualizer::Oscilloscope osc_;
  size_t oscReadPos_{0};
  size_t oscSamplesSeen_{0};
  size_t oscDisplaySamples_{2048};
  std::chrono::steady_clock::time_point oscLastDrainTime_{};
  double oscDrainCarrySamples_{0.0};
  int oscAppliedSampleRate_{0};

};

}  // namespace astra
