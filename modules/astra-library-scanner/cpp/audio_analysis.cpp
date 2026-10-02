#include "audio_analysis.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace astra::analysis {
LoudnessMeter::LoudnessMeter(unsigned channels, unsigned sampleRate)
    : channels_(channels), blockFrames_(std::max(1u, static_cast<unsigned>(0.4 * sampleRate))),
      s1a_(channels), s2a_(channels), s1b_(channels), s2b_(channels), blockSum_(channels) {
  const double pi = std::acos(-1.0);
  const double ka = std::tan(pi * 1681.974450955533 / sampleRate);
  const double vh = std::pow(10.0, 3.999843853973347 / 20.0);
  const double vb = std::pow(vh, 0.4996667741545416);
  const double qa = 0.7071752369554196;
  const double a0a = 1 + ka / qa + ka * ka;
  b0a_ = (vh + vb * ka / qa + ka * ka) / a0a;
  b1a_ = 2 * (ka * ka - vh) / a0a;
  b2a_ = (vh - vb * ka / qa + ka * ka) / a0a;
  a1a_ = 2 * (ka * ka - 1) / a0a;
  a2a_ = (1 - ka / qa + ka * ka) / a0a;
  const double kb = std::tan(pi * 38.13547087602444 / sampleRate);
  const double qb = 0.5003270373238773;
  const double a0b = 1 + kb / qb + kb * kb;
  a1b_ = 2 * (kb * kb - 1) / a0b;
  a2b_ = (1 - kb / qb + kb * kb) / a0b;
}

void LoudnessMeter::process(double sample, unsigned ch) {
  peak_ = std::max(peak_, std::abs(sample));
  const double y1 = b0a_ * sample + s1a_[ch];
  s1a_[ch] = b1a_ * sample - a1a_ * y1 + s2a_[ch];
  s2a_[ch] = b2a_ * sample - a2a_ * y1;
  const double y2 = y1 + s1b_[ch];
  s1b_[ch] = -2 * y1 - a1b_ * y2 + s2b_[ch];
  s2b_[ch] = y1 - a2b_ * y2;
  blockSum_[ch] += y2 * y2;
  if (ch == channels_ - 1 && ++framesInBlock_ >= blockFrames_) finishBlock();
}

void LoudnessMeter::finishBlock() {
  if (!framesInBlock_) return;
  double energy = 0;
  for (auto& sum : blockSum_) { energy += sum / framesInBlock_; sum = 0; }
  framesInBlock_ = 0;
  if (energy > 0) energies_.push_back(energy);
}

double LoudnessMeter::finish() {
  finishBlock();
  const double absolute = std::pow(10.0, (-70 + 0.691) / 10.0);
  double sum = 0;
  size_t count = 0;
  for (auto e : energies_) if (e >= absolute) { sum += e; ++count; }
  if (!count) return -70;
  const double relativeLufs = -0.691 + 10 * std::log10(sum / count);
  const double relative = std::pow(10.0, (relativeLufs - 10 + 0.691) / 10.0);
  sum = 0; count = 0;
  for (auto e : energies_) if (e >= absolute && e >= relative) { sum += e; ++count; }
  return count ? -0.691 + 10 * std::log10(sum / count) : -70;
}

Accumulator::Accumulator(unsigned bins, uint64_t totalFrames, unsigned channels,
                         unsigned sampleRate, bool withLoudness)
    : bins_(bins), channels_(channels), totalFrames_(totalFrames), withLoudness_(withLoudness),
      sums_(bins), counts_(bins), meter_(channels, sampleRate) {
  if (!bins || bins > 16384 || !totalFrames || totalFrames > (uint64_t{1} << 48) ||
      !channels || channels > 32 || sampleRate < 8000 || sampleRate > 768000) {
    throw std::invalid_argument("Invalid analysis dimensions");
  }
}

void Accumulator::consume(const float* pcm, size_t frames) {
  size_t offset = 0;
  while (offset < frames) {
    const auto bin = static_cast<unsigned>(std::min<uint64_t>(frame_ * bins_ / totalFrames_, bins_ - 1));
    const auto boundary = ((bin + 1) * totalFrames_ + bins_ - 1) / bins_;
    const auto run = std::min<uint64_t>(frames - offset, boundary > frame_ ? boundary - frame_ : 1);
    double sum = 0;
    const size_t end = (offset + run) * channels_;
    for (size_t j = offset * channels_; j < end; ++j) {
      const double v = pcm[j];
      if (!std::isfinite(v)) throw std::runtime_error("Non-finite PCM");
      sum += v * v;
      if (withLoudness_) meter_.process(v, static_cast<unsigned>(j % channels_));
    }
    sums_[bin] += sum;
    counts_[bin] += run * channels_;
    frame_ += run;
    offset += run;
    filled_ = std::max(filled_, bin);
  }
}

std::vector<float> Accumulator::prefix(unsigned bins) const {
  std::vector<float> out(std::min(bins, bins_));
  for (size_t i = 0; i < out.size(); ++i) {
    if (counts_[i]) out[i] = static_cast<float>(std::sqrt(sums_[i] / counts_[i]));
  }
  return out;
}

std::vector<float> Accumulator::finishPeaks() const {
  auto out = prefix(bins_);
  double maximum = 0;
  for (size_t i = 0; i < sums_.size(); ++i) {
    if (counts_[i]) maximum = std::max(maximum, std::sqrt(sums_[i] / counts_[i]));
  }
  if (maximum > 0) for (auto& v : out) v = static_cast<float>(v / maximum);
  return out;
}
}  // namespace astra::analysis
