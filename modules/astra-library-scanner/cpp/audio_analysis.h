#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace astra::analysis {

// Matches the mobile meter: K weighting, 400 ms non-overlapping blocks,
// absolute/relative gating, unity channel weights, and sample (not true) peak.
class LoudnessMeter {
 public:
  LoudnessMeter(unsigned channels, unsigned sampleRate);
  void process(double sample, unsigned channel);
  double finish();
  double peak() const { return peak_; }
 private:
  void finishBlock();
  unsigned channels_, blockFrames_, framesInBlock_ = 0;
  double b0a_, b1a_, b2a_, a1a_, a2a_, a1b_, a2b_, peak_ = 0;
  std::vector<double> s1a_, s2a_, s1b_, s2b_, blockSum_, energies_;
};

class Accumulator {
 public:
  Accumulator(unsigned bins, uint64_t totalFrames, unsigned channels,
              unsigned sampleRate, bool withLoudness);
  void consume(const float* pcm, size_t frames);
  std::vector<float> prefix(unsigned bins) const;
  std::vector<float> finishPeaks() const;
  double finishLoudness() { return meter_.finish(); }
  double samplePeak() const { return meter_.peak(); }
  unsigned filledBins() const { return filled_; }
  uint64_t frames() const { return frame_; }
 private:
  unsigned bins_, channels_, filled_ = 0;
  uint64_t totalFrames_, frame_ = 0;
  bool withLoudness_;
  std::vector<double> sums_;
  std::vector<uint64_t> counts_;
  LoudnessMeter meter_;
};
}  // namespace astra::analysis
