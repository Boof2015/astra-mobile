# Mobile waveform analysis

Offline analysis uses streaming `dr_flac`, `dr_mp3`, `dr_wav`, and `libopusfile`
decoders through JNI. Playback remains in RNTP/ExoPlayer. Other containers, unsupported descriptors,
and recoverable native decoder failures use the existing MediaCodec analysis path.
Cancelled/timed-out attempts never trigger fallback. Both paths require successful
completion before their waveform or loudness results can be persisted.

PCM stays in bounded native buffers. Waveform and optional loudness share a pass;
the 512-bin cache schema and mobile RMS/loudness math are unchanged. MP3 analysis
honors Xing/LAME encoder delay and padding. Unknown MP3 frame counts use the
catalog/player duration hint instead of scanning the file twice; missing duration
information falls back to MediaCodec.

Ogg Opus uses pinned `libopusfile`, `libopus`, and `libogg` sources. Granule-based
frame counts account for pre-skip and final padding without a second audio decode.
Analysis runs at Opus's 48 kHz output rate, applies the header output gain, and
leaves R128 track/album gains to normalization. Mono, stereo, and standard surround
layouts are supported, including chains with a consistent channel count. Changing
channel counts or unsupported mappings fall back to Android. Missing EOS markers,
packet holes, and decode errors never produce a successful native result. Tiny
floating-point denormal guards in otherwise silent Opus output are zeroed before
analysis to keep silent waveforms empty.

`AnalysisCoordinator` reserves capacity for interactive work, with two active jobs
at most and one prefetch at most. An upcoming track is promoted in place when it
becomes current. Cancellation retains ownership until teardown finishes, and
attempt IDs reject stale progress/cancellation. Prefetch covers five upcoming local
tracks even when normalization is disabled, in which case it omits loudness work.

## Release benchmark — 2026-10-02

Device: Samsung SM-S908U1 (Galaxy S22 Ultra), Android 16, arm64-v8a. Release-mode
library/instrumentation build, 180-second generated stereo 48 kHz fixtures, five
timed runs per combination after one warm-up of each decoder. Decoder order
alternates. A muted, looping AAC MediaPlayer remains active; concurrent prefetch
is one additional full-file analysis. Waveform/loudness caches are bypassed.

Median full-analysis wall time, milliseconds:

| Format | Loudness | Prefetch | MediaCodec | Native | Speedup |
| --- | --- | --- | ---: | ---: | ---: |
| FLAC | Off | Off | 1442 | 161 | 9.0× |
| FLAC | Off | On | 1575 | 173 | 9.1× |
| FLAC | On | Off | 1354 | 263 | 5.2× |
| FLAC | On | On | 1886 | 271 | 7.0× |
| MP3 | Off | Off | 6961 | 167 | 41.7× |
| MP3 | Off | On | 6344 | 188 | 33.7× |
| MP3 | On | Off | 9607 | 240 | 40.1× |
| MP3 | On | On | 5935 | 253 | 23.5× |
| WAV | Off | Off | 1322 | 40 | 32.9× |
| WAV | Off | On | 1107 | 49 | 22.8× |
| WAV | On | Off | 1538 | 124 | 12.4× |
| WAV | On | On | 1012 | 149 | 6.8× |

All 120 runs completed. Native median first-fill times were 0.4–9.6 ms versus
33.8–105.3 ms for MediaCodec. Sampled median PSS increases were 0–36 KiB for native
versus 338–10,900 KiB for MediaCodec across workloads. PSS is process-wide and
sampled every 10 ms, so small/short-lived allocations are not resolved precisely.
Native full-analysis and first-fill medians improved in every workload, with no
median memory-increase regression; the three native routes are enabled.

These results measure offline analysis in a test process, not end-to-end tap-to-paint
latency. They exclude JS preparation, scheduler wait, database persistence, and
rendering. Filesystem caches are warm, the audio is synthetic, playback uses
MediaPlayer rather than Astra's full UI, and only one device was measured. Five
samples per workload establish a direction, not a dependable population p95.
See the [raw measurements](benchmarks/waveform-analysis-sm-s908u1-2026-10-02.csv).

### Ogg Opus follow-up

Same device and method, with the 180-second source encoded at 128 kbps using
libopus. Five repetitions for each backend/workload, 40 timed runs in total; all
completed successfully. The same warm-cache and test-process limitations above
apply. This measures decoder work, not the app's end-to-end rendering latency.

| Loudness | Prefetch | MediaCodec median ms | Native median ms | Speedup |
| --- | --- | ---: | ---: | ---: |
| Off | Off | 11259 | 521 | 21.6× |
| Off | On | 8729 | 540 | 16.2× |
| On | Off | 15268 | 597 | 25.6× |
| On | On | 9780 | 674 | 14.5× |

Native median first-fill times were 6.3–13.8 ms versus 64.9–110.3 ms for
MediaCodec. Median sampled PSS increases were 0–96 KiB versus 4,782–10,661 KiB.
Completion, first fill, and sampled memory improved in every workload, so the
native Ogg Opus route is enabled. The arm64 analysis library is approximately
384 KiB stripped, including all four decoder routes.

See the [Opus measurements](benchmarks/opus-analysis-sm-s908u1-2026-10-02.csv).

## Reproduction

Run `npm run test:analysis` and `npm run test:analysis-native` for scheduler/cache
tests and portable C++ tests. Host native tests require CMake and a C/C++ compiler.

Generate optional benchmark assets (requires ffmpeg):

```sh
python3 scripts/generate-analysis-fixtures.py /tmp/astra-analysis-assets/analysis-benchmark 180
```

From `android`, with a connected device:

```sh
./gradlew :astra-library-scanner:connectedReleaseAndroidTest \
  -PastraAnalysisTestBuildType=release \
  -PreactNativeArchitectures=arm64-v8a \
  -PastraAnalysisBenchmarkAssets=/tmp/astra-analysis-assets \
  -Pandroid.testInstrumentationRunnerArguments.class=expo.modules.astralibraryscanner.AudioAnalysisTest \
  -Pandroid.testInstrumentationRunnerArguments.analysisBenchmark=true
```

Without the final argument, the benchmark is skipped and correctness tests run.
To benchmark only Opus, also pass
`-Pandroid.testInstrumentationRunnerArguments.analysisBenchmarkFormats=opus`.
Detailed measurements are logged under `AstraAnalysisBenchmark`, retained in
Gradle's connected-test reports, and written to the test application's external
files directory as `analysis-benchmark.csv` while it is installed. The test APK is
separate from Astra and does not access its library databases.
