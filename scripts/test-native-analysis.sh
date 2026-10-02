#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
binary=$(mktemp /tmp/astra-analysis-tests.XXXXXX)
trap 'rm -f "$binary"' EXIT
clang++ -std=c++17 -O2 -ffp-contract=off -Wall -Wextra \
  -I"$root/modules/astra-library-scanner/third_party/dr_libs" \
  "$root/modules/astra-library-scanner/cpp/audio_analysis.cpp" \
  "$root/modules/astra-library-scanner/cpp/audio_decoder.cpp" \
  "$root/modules/astra-library-scanner/cpp/audio_analysis_test.cpp" -o "$binary"
"$binary" "$root/test/fixtures/analysis"
