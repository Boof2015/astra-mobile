#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
build=$(mktemp -d /tmp/astra-analysis-tests.XXXXXX)
trap 'rm -rf "$build"' EXIT
cmake -S "$root/modules/astra-library-scanner/cpp" -B "$build" \
  -DCMAKE_BUILD_TYPE=Release > "$build/configure.log" 2>&1 || { cat "$build/configure.log"; exit 1; }
cmake --build "$build" --parallel 4 > "$build/build.log" 2>&1 || { cat "$build/build.log"; exit 1; }
"$build/astra_analysis_tests" "$root/test/fixtures/analysis"
