# Android release optimization

Google Play, GitHub, and Astra Dev preview builds use R8 shrinking, optimization,
obfuscation, and optimized resource shrinking. Debug builds retain normal
debugging behavior. Configure this through `app.json` and the Astra Android
release config plugin; generated `android/` edits are lost on clean prebuild.

The release plugin selects `proguard-android-optimize.txt`, enables AGP 8.12's
optimized resource shrinker, and preserves the notification drawables resolved
by name. Existing native scanner annotations and dependency keep rules protect
JNI entry points. The additional keep rule for `expo.modules.kotlin.records.**`
protects Expo's reflection-based record converters: full optimization without
this rule caused a startup NPE converting `AstraWidget.setNowPlaying` arguments
on a physical phone. Keep this exception scoped to the record-conversion package.

## Build and verify

```sh
npx expo prebuild --platform android --no-install --clean
python3 scripts/verify-android-optimization.py generated
npm run test:release-config
python3 -m unittest discover -s scripts/tests -p 'test_android_*.py'
```

Use the existing candidate workflow for signed production artifacts. Local
`npm run android:preview` builds use the same optimization settings with a
separate application ID and test signing. Never upload a test-signed artifact.

After building an AAB:

```sh
python3 scripts/verify-android-optimization.py artifact android/app/build/outputs/bundle/release/app-release.aab --mapping-dir android/app/build/outputs/mapping/release
```

APK verification additionally requires the compiler's external metadata:

```sh
python3 scripts/verify-android-optimization.py artifact android/app/build/outputs/apk/release/app-release.apk --mapping-dir android/app/build/outputs/mapping/release --r8-metadata android/app/build/intermediates/r8_metadata/release/minifyReleaseWithR8/r8-metadata.dat
```

Candidate preparation runs these checks automatically. They reject missing
reports, global optimization opt-outs, disabled R8 features, stale DEX metadata,
and AABs without the matching embedded mapping. Coverage is calculated as
`100 - no*Percentage` from R8's statistics; all three categories must meet 25%
when uncompressed DEX size reaches 10,000,000 bytes (a conservative 10 MB cutoff).

Each candidate's `optimization/` directory retains `mapping.txt`, effective
configuration, seeds, removed-code and resource reports, `r8.json`, and
`optimization.json` with the artifact hash, DEX size, and coverage. Archive these
with the exact tested APK/AAB for future crash retracing. Workflow artifacts
expire after 30 days. The SDK-free CI job also retains its R8 outputs.

## Runtime and Play acceptance

Test the actual optimized app after an update and cold restart: existing
library/database loading, metadata and artwork scanning, waveform/loudness
analysis, playback and EQ/scopes, background/notification controls, widgets,
Android Auto, TV navigation, desktop connections, and Discord. Native module
debug tests do not exercise the app's optimized DEX. Resolve failures with
targeted keep rules and repeat affected device checks.

Before promoting the internal-test AAB, inspect its results in Play's App Bundle
Explorer and record the version code, artifact hash, DEX size, and all three
percentages. Require at least 25% obfuscation, shrinking, and optimization while
the bundle meets Play's DEX size threshold. Build success and local size
reduction alone do not close a Play warning. See
[Google's DEX guidance](https://developer.android.com/google/play/vitals/code-optimization).

## Local validation — 2026-10-11

AGP 8.12.0 / R8 8.12.14, both `armeabi-v7a` and `arm64-v8a`:

| Artifact | Uncompressed DEX bytes | Obfuscation | Shrinking | Optimization |
| --- | ---: | ---: | ---: | ---: |
| Astra Dev preview APK | 14,627,528 | 82.75% | 83.07% | 82.25% |
| GitHub release APK | 14,627,528 | 82.75% | 83.07% | 82.25% |
| Google Play release AAB | 14,627,528 | 82.75% | 83.07% | 82.25% |
| SDK-free preview APK | 14,177,368 | 85.22% | 85.55% | 84.70% |

The original preview had about 58.4 MB of uncompressed DEX. These are local R8
statistics, not Play Console results. Production variants were test-signed for
local validation and must not be uploaded. The inspected Play AAB SHA-256 was
`2b3a09d433ee1d677e3803949e8e74181d41188a97355e9ae7edacba14e6c7a6`.
Its embedded mapping and R8 metadata matched the retained reports and DEX hashes.
The final candidate workflow must generate and verify fresh signed artifacts.

Passed: clean prebuild, repeated prebuild with the record-conversion rule, 771
release tests, 24 release-config tests, 25 Android packaging-verifier tests, 157
native unit tests, typecheck, lint, native 16 KB packaging and Discord packaging
checks. Scanner JNI callback classes, scope JNI methods, and Discord native
entry points retain their names in the mapping. Both notification drawables are
reported reachable from the keep XML.

Physical Galaxy S22 Ultra (Android 16): update without clearing app data, cold
launch, existing library/artwork loading, library scan, fresh native FLAC and
platform AAC waveform/loudness analysis, playback, EQ and scope rendering,
background playback, widget rendering/pause control, and Discord's successful
presence status. Desktop discovery, PIN pairing, live metadata, and remote
play/pause succeeded against Astra Desktop 0.8.0-beta. The temporary pairing was
revoked and desktop connection settings restored afterward. Android Auto host
instrumentation against the optimized app
passed all 20 automatic transitions with the phone locked: 0 ms worst observed
metadata delay, 60 ms worst playback-clock difference. Google TV Streamer:
cold launch, library artwork, and D-pad navigation through Home/Library/Settings.

Still required before closing the Play warning: production-signed internal-test
upload and Play Console confirmation of all three percentages. The host test
does not replace a visual check in a physical car or Desktop Head Unit.
