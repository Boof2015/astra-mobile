#include "audio_analysis.h"
#include "audio_decoder.h"
#include <cassert>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <fcntl.h>
#include <fstream>
#include <iostream>
#include <iterator>
#include <limits>
#include <ogg/ogg.h>
#include <unistd.h>

namespace {
using Bytes = std::vector<unsigned char>;
Bytes readFile(const std::string& path) {
  std::ifstream file(path, std::ios::binary);
  assert(file.good());
  return Bytes(std::istreambuf_iterator<char>(file), {});
}
astra::analysis::DecodeResult analyzeBytes(const Bytes& bytes, int64_t offset = 0, int64_t length = -1) {
  char name[] = "/tmp/astra-opus-test.XXXXXX";
  const int fd = mkstemp(name);
  assert(fd >= 0);
  unlink(name);
  assert(write(fd, bytes.data(), bytes.size()) == static_cast<ssize_t>(bytes.size()));
  auto result = astra::analysis::decode(fd, offset, length, 512, true, 0,
    [] { return false; }, [](const auto&, unsigned) {});
  close(fd);
  return result;
}
// Mutate complete fixture pages while keeping their Ogg checksums valid.
template<class Update> void updatePages(Bytes& bytes, Update update) {
  for (size_t offset = 0; offset < bytes.size();) {
    assert(offset + 27 <= bytes.size() && std::memcmp(bytes.data() + offset, "OggS", 4) == 0);
    const size_t headerSize = 27 + bytes[offset + 26];
    size_t bodySize = 0;
    for (size_t i = 27; i < headerSize; ++i) bodySize += bytes[offset + i];
    assert(offset + headerSize + bodySize <= bytes.size());
    ogg_page page{bytes.data() + offset, static_cast<long>(headerSize),
                  bytes.data() + offset + headerSize, static_cast<long>(bodySize)};
    update(page);
    ogg_page_checksum_set(&page);
    offset += headerSize + bodySize;
  }
}
void testOpus(const std::string& directory) {
  const auto bytes = readFile(directory + "/signal.opus");
  const auto original = analyzeBytes(bytes);
  assert(original.completed && original.decoder == "libopusfile" && original.sampleRate == 48000);
  assert(original.channels == 2 && std::abs(original.durationMs - 1300) < 1e-9);
  for (const auto& entry : {std::pair{"mono.opus", 1u}, {"surround.opus", 6u},
                            {"short.opus", 2u}, {"silent.opus", 2u}, {"long-packet.opus", 2u}}) {
    const auto result = analyzeBytes(readFile(directory + "/" + entry.first));
    if (!result.completed) std::cerr << entry.first << ": " << result.error << '\n';
    assert(result.completed && result.channels == entry.second && result.sampleRate == 48000);
    if (std::string(entry.first) == "short.opus") assert(std::abs(result.durationMs - 3) < 1e-9);
    if (std::string(entry.first) == "silent.opus") {
      assert(result.peak == 0 && result.lufs == -70);
      assert(std::all_of(result.peaks.begin(), result.peaks.end(), [](float v) { return v == 0; }));
    }
  }
  auto padded = Bytes(127, 0x5a);
  padded.insert(padded.end(), bytes.begin(), bytes.end());
  padded.resize(padded.size() + 97, 0x5a);
  const auto offset = analyzeBytes(padded, 127, bytes.size());
  assert(offset.completed && offset.peaks == original.peaks && offset.lufs == original.lufs);

  auto quieter = bytes;
  updatePages(quieter, [](ogg_page& page) {
    if (page.body_len >= 19 && std::memcmp(page.body, "OpusHead", 8) == 0) {
      const auto gain = static_cast<uint16_t>(static_cast<int16_t>(-6 * 256));
      page.body[16] = gain & 255; page.body[17] = gain >> 8;
    }
  });
  const auto gain = analyzeBytes(quieter);
  assert(gain.completed && std::abs(gain.lufs - original.lufs + 6) < .001);
  assert(std::abs(gain.peak / original.peak - std::pow(10, -6.0 / 20)) < .0001);
  for (size_t i = 0; i < original.peaks.size(); ++i) assert(std::abs(gain.peaks[i] - original.peaks[i]) < .00001);
  const auto taggedGain = analyzeBytes(readFile(directory + "/gain.opus"));
  assert(taggedGain.completed && std::abs(taggedGain.lufs - gain.lufs) < .0001);
  assert(std::abs(taggedGain.peak - gain.peak) < .0001);

  // A second serial number makes a valid chained stream. Preserve each link's gain.
  updatePages(quieter, [](ogg_page& page) { page.header[14] ^= 0x55; });
  auto chained = bytes;
  chained.insert(chained.end(), quieter.begin(), quieter.end());
  const auto chain = analyzeBytes(chained);
  assert(chain.completed && std::abs(chain.durationMs - 2600) < 1e-9);

  auto mixed = bytes;
  const auto mono = readFile(directory + "/mono.opus");
  mixed.insert(mixed.end(), mono.begin(), mono.end());
  assert(!analyzeBytes(mixed).completed);

  auto noEos = bytes;
  updatePages(noEos, [](ogg_page& page) { page.header[5] &= ~4; });
  assert(!analyzeBytes(noEos).completed);
  auto corrupted = bytes;
  corrupted.back() ^= 0xff;
  assert(!analyzeBytes(corrupted).completed);
  assert(!analyzeBytes(Bytes(bytes.begin(), bytes.end() - 100)).completed);

  char name[] = "/tmp/astra-opus-cancel.XXXXXX";
  const int fd = mkstemp(name);
  assert(fd >= 0); unlink(name);
  assert(write(fd, bytes.data(), bytes.size()) == static_cast<ssize_t>(bytes.size()));
  bool cancel = false;
  const auto interrupted = astra::analysis::decode(fd, 0, -1, 512, true, 0,
    [&] { return cancel; }, [&](const auto&, unsigned) { cancel = true; });
  assert(interrupted.cancelled && !interrupted.completed && interrupted.peaks.empty());
  close(fd);
}
} // namespace

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
  for (const char* name : {"signal.wav", "signal.flac", "signal.mp3", "no-xing.mp3", "signal.opus"}) {
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
  testOpus(argv[1]);
  std::cout << "Native accumulator and decoder tests passed\n";
}
