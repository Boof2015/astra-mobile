#include "audio_analysis.h"
#include "audio_decoder.h"
#include <cassert>
#include <cmath>
#include <fcntl.h>
#include <iostream>
#include <limits>
#include <unistd.h>

int main(int argc, char** argv) {
  using namespace astra::analysis;
  {
    const float samples[] = {0, 0, .25f, .25f, .5f, .5f, 1, 1, 1};
    Accumulator a(4, 9, 1, 48000, true);
    a.consume(samples, 3); a.consume(samples + 3, 6);
    const auto peaks = a.finishPeaks();
    assert(std::abs(peaks[0] - std::sqrt(.0625 / 3)) < 1e-6);
    assert(std::abs(peaks[1] - std::sqrt(.3125 / 2)) < 1e-6);
    assert(a.frames() == 9 && a.filledBins() == 3 && a.samplePeak() == 1);
    assert(std::isfinite(a.finishLoudness()));
  }
  {
    const float silent[6]{};
    Accumulator a(512, 3, 2, 96000, true);
    a.consume(silent, 3);
    for (auto v : a.finishPeaks()) assert(v == 0);
    assert(a.finishLoudness() == -70 && a.samplePeak() == 0);
  }
  {
    Accumulator a(1, 1, 1, 48000, false);
    const float bad = std::numeric_limits<float>::quiet_NaN();
    bool rejected = false;
    try { a.consume(&bad, 1); } catch (...) { rejected = true; }
    assert(rejected);
  }
  assert(argc == 2);
  for (const char* name : {"signal.wav", "signal.flac", "signal.mp3", "no-xing.mp3"}) {
    const auto filename = std::string(argv[1]) + "/" + name;
    const int fd = open(filename.c_str(), O_RDONLY);
    assert(fd >= 0);
    auto result = decode(fd, 0, -1, 512, true, 1300, [] { return false; }, [](const auto&, unsigned) {});
    if (!result.completed) std::cerr << name << ": " << result.error << '\n';
    assert(result.completed && result.peaks.size() == 512 && std::isfinite(result.lufs));
    auto cancelled = decode(fd, 0, -1, 512, true, 1300, [] { return true; }, [](const auto&, unsigned) {});
    assert(cancelled.cancelled && !cancelled.completed && cancelled.peaks.empty());
    auto truncated = decode(fd, 0, 32, 512, true, 1300, [] { return false; }, [](const auto&, unsigned) {});
    assert(!truncated.completed);
    if (std::string(name) == "no-xing.mp3") {
      auto wrongDuration = decode(fd, 0, -1, 512, true, 60000, [] { return false; }, [](const auto&, unsigned) {});
      assert(!wrongDuration.completed && wrongDuration.error == "Duration hint does not match decoded stream");
    }
    close(fd);
  }
  std::cout << "Native accumulator and decoder tests passed\n";
}
