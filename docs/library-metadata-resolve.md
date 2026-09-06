# Mobile metadata and Astra Resolve

The Android scanner uses vendored TagLib 2.3.2 for container metadata. Native
catalog construction and the shared TypeScript helpers follow desktop commit
`7e9d3dd` for artist identities and album grouping.

## Review milestone 1: reliable tags

Start with `modules/astra-library-scanner/cpp/tag_reader.cpp`,
`android/src/main/java/expo/modules/astralibraryscanner/NativeTagReader.kt`, and
`data/ContainerTags.kt`. The module's CMake build is offline and pins the source
archive and checksum in `third_party/README.md`. Upstream licenses and attribution
are retained in source and packaged under `assets/notices/taglib`.

The bridge borrows read-only descriptors, respects asset offsets and lengths,
and uses independent positional reads. Pipe providers are copied to temporary
disk files with polling, cancellation, deadlines, and cleanup. No audio or cover
byte arrays enter JavaScript. Four concurrent parser operations limit artwork
allocations; the scanner retains its existing bounded discovery/staging workers.
JNI strings use UTF-16 so supplementary Unicode characters survive.

TagLib supplies tags, totals, pictures, and available audio properties. Android
readers fill holes independently. Their failures cannot reject successful native
metadata. ARTISTS/ALBUMARTISTS take precedence over scalar display credits;
extraction preserves their order and never splits punctuation. Legacy Japanese
encoding repair is confined to the Android fallback. Artwork selection prefers a
valid front cover, another valid embedded image, then the folder cover. Text
metadata survives invalid images. Native scan logging separates container,
Android, technical-format, and artwork time, and records fallback failures.

Catalog schema 2 → 3 adds nullable track/disc totals and reader version 0 for old
rows. Reader version 2 makes unchanged local files eligible for one upgrade;
successful upgrades then use the incremental fast path. Failed old reads retain
their old rows and remain eligible for retry. Unchanged-file refreshes preserve
import times, paths, and loudness/ReplayGain/BPM/key caches. User data continues
to live in the separate user database.

## Review milestone 2: Astra Resolve

Start with `data/ArtistResolve.kt`, `data/AlbumResolve.kt`, and
`data/CatalogReadModelBuilder.kt`, then the adapters in `src/library` and shared
helpers in `src/shared/library`. Each prospective catalog supplies one source
evidence index. Inferred arrays are derived outputs and never train the index.
Release partitions use the reference's en-US ICU ordering, including mixed-case
paths with overlapping year evidence.

Schema 3 → 4 adds separate resolved credit arrays and a catalog Resolve version.
Version 1 rebuilds derived state from the complete stored catalog, including
remote tracks, at bootstrap. Source publication and removal also rebuild all
derived memberships and album identities. Remote artwork identities include
source type and server ID. Local grouping uses the original embedded/folder
artwork identity, before thumbnails or artist image overrides.

Staged generations keep the active catalog intact until publication. Publication
refreshes native pages, search, and the current playing track. Playback models
carry explicit resolved arrays. Now Playing links preserve literal credit
separators and refresh their catalog identity even when the track is outside
loaded pages. Album routes follow a track anchor when regrouping changes its
album key. The existing `astra` / `fileTags` preference and default are retained;
the label is now “Astra Resolve.”

Music files remain read-only. Playback decoding and the separate embedded-lyrics
and ReplayGain readers retain their existing workflows.

## Reproducible validation

`test/fixtures/metadata` contains 13 actual container variants plus alternate
Opus aliases, repeated credits, malformed-cover, and untagged cases. Instrumented
tests exercise file URIs, a SAF-style descriptor provider, non-seekable pipes,
cancellation, deadlines, unreadable files, front-cover priority, and Opus pictures
larger than one Ogg page. See that directory's README for generation and the
documented desktop ASF/picture-selection discrepancies.

`test/fixtures/resolve/desktop.json` is captured from the desktop implementation,
not the mobile port. Both Kotlin and TypeScript consume the same expectations.
Regenerate with `node scripts/generate-resolve-fixtures.mjs ../astra`. The copied
desktop tests also run directly against the TypeScript port.

Commands used from the project root:

```sh
npm run test:release
npm run typecheck
npm run test:resolve
cd android
./gradlew :astra-library-scanner:testDebugUnitTest :astra-library-scanner:connectedDebugAndroidTest :app:assemblePreview -PreactNativeArchitectures=armeabi-v7a,arm64-v8a
```

Validation on September 5, 2026:

| Check | Result |
| --- | --- |
| TypeScript release suite | 514 tests passed, including 47 Resolve/artist/UI cases |
| Kotlin JVM tests | 51 passed |
| Android instrumentation | 49 passed on Samsung SM-S908U1, Android 16 |
| Typecheck, targeted ESLint, whitespace checks | Passed |
| Preview native build | Passed for both shipped ARM ABIs |
| Real development-app upgrade | Automatic refresh retained all 1,757 tracks; listening history and paused queue remained available |
| Visual checks | Resolve selection retained; Now Playing → artist → album navigation worked, with Unicode titles and numbered tracks |

The instrumentation suite also covers Room migrations, failed-read retries,
preserved favorites/import dates/analysis, generation cancellation and failure,
unchanged-scan reuse, and reversible regrouping after source evidence is added
or removed. Its 100,000-row catalog test completed successfully.

The 13-file parser smoke benchmark measured **234 ms native** versus **731 ms
Android/ExoPlayer** on this device; the Android path failed on two containers.
PSS was 100,454 KiB before and 100,209 KiB after the combined batch. This is a
small synthetic parser comparison, not a full-library or peak-memory benchmark.
One real-app snapshot during the upgrade/image-refresh period showed 552,256
KiB PSS, including React Native, graphics, artwork caches, and automatic artist
image downloads; no comparable pre-upgrade process snapshot was captured.

The stripped `libastratags.so` is **731,760 bytes on ARM64** and **427,512 bytes
on ARMv7**. The baseline installed APK contained only ARM64, while the verified
preview includes both shipping ABIs; their overall APK sizes are therefore not
a like-for-like measure of parser growth. Test audio and reference fixtures are
instrumentation assets and are not included in the application APK.
