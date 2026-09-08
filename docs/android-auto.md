# Android Auto

Astra retains its RNTP/ExoPlayer playback engine, DSP chain, and separate car browser session. The car session is a native projection of the player. React supplies logical shuffle/repeat state and executes catalog/queue commands; it does not publish now-playing metadata or the playback clock.

## Native updates

`BaseAudioPlayer.nativePlaybackObserver` runs after ExoPlayer's event batch and on metadata edits. The RNTP patch publishes track and occurrence identity, original artwork identity, duration, position, buffering/error state, speed, and an elapsed-realtime timestamp. A player generation and sequence reject old callbacks. New browser subscribers receive the latest snapshot immediately. Teardown retains a paused resume card.

The presenter compares metadata contents before calling `setMetadata`. Playback state carries Android's monotonic timestamp and speed; the host advances progress between events. Artwork completion refreshes the current snapshot rather than retaining a captured track. The previous JavaScript 150 ms car synchronization timer is gone. Widget synchronization remains separate. Queue chunks yield through a native coroutine as well; a JavaScript timeout previously could strand the rolling queue after its first few tracks while the phone was locked.

The locked-screen integration run also exposed an existing EQ state-buffer crash when a track changes channel count. Filter state now adopts the new format at `flush()` and resizes per-channel buffers; the EQ coefficients and processing chain are unchanged.

## Queue and commands

The native session publishes at most 100 queue entries around the active occurrence. The Queue browser starts at the current song with up to 30 current/upcoming entries, followed by access to earlier and later portions. Other browse pages query Room directly, including dynamic playlists. Existing section, album, artist, playlist, track, and numeric range IDs remain readable.

Small collections display their contents directly. Large Tracks, Albums, Artists, and Favorites collections use actual alphabetical groups (up to four letters per group when the contents fit). They share the catalog's ICU sort keys and accent-normalized letter labels. A dense letter, or a large collection in other scripts, splits into folders named for their first and last items. Playlist contents retain their saved or dynamic order and use song names for any necessary subdivisions. Artist pages show albums, including credited appearances. Favorites browse A–Z, with a Recently Favorited shortcut; playing from A–Z uses that same alphabetical order. All browse responses remain bounded to 100 items.

Room occurrence IDs include the queue session, its creation epoch, and entry ID. Replacement epochs are allocated transactionally; edits preserve them. Selection resolves the entry again, checks the current revision, and rejects removed/replaced entries. Runtime queues use the native player generation plus a unique occurrence ID.

Car commands run through one FIFO JavaScript coordinator. Each native request has a unique ID, completion result, and deadline. Expired queued work is discarded. The bound service owns its wake lock and retains a temporary binding while work is active; it releases both when its last task finishes. Browser connection only hydrates credentials and paused restoration. Playback requires a Play request.

Shuffle/repeat use Astra's controller, including virtual repeat-all. Repeat cycles off → all → one. Favorites refresh from Room invalidation. Home, Library, Playlists, and Queue subscriptions refresh after relevant database changes. Hosts advertising custom browse actions receive Play next and Add to queue, limited to their advertised capacity. Other hosts retain browsing and playback.

## Artwork

Local artwork comes from `astraArtworkData` and the catalog identity, not notification thumbnails. Remote URL templates remain in SecureStore and are registered only in native process memory. Exported content URIs and car resume cards contain no authenticated artwork URLs. Cache keys include an opaque source configuration version.

The provider serves images bounded to 512 px for now-playing and 128 px for browsing. Remote misses download asynchronously, share downloads across sizes, and have byte/time limits and bounded retries. Until an image is ready, the car receives a placeholder. Configuration changes invalidate cached identities; late downloads cannot publish an old track's art. The image cache is bounded to 64 MiB.

## Validation

Commands from the repository root:

```sh
npm run typecheck
npm run lint
npm run test:car
npm run test:queue-actions
npm run test:session
npm run test:audio-startup
npm run test:seek-bar
npm run test:dynamic-playlists
```

From `android/`:

```sh
./gradlew :astra-car:testDebugUnitTest :astra-library-scanner:testDebugUnitTest :kotlin-audio:testDebugUnitTest :app:assembleDebug -PreactNativeArchitectures=arm64-v8a
./gradlew :astra-car:connectedDebugAndroidTest :kotlin-audio:connectedDebugAndroidTest -PreactNativeArchitectures=arm64-v8a
./gradlew :astra-library-scanner:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=expo.modules.astralibraryscanner.data.RoomLibraryRepositoryTest -PreactNativeArchitectures=arm64-v8a
```

The optional host acceptance test controls the installed **development** app. Attach the Desktop Head Unit, select a playable queue, then run:

```sh
./gradlew :astra-car:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=expo.modules.astracar.AstraCarHostAcceptanceTest -Pandroid.testInstrumentationRunnerArguments.astraCarTarget=io.github.boof2015.astra.dev -PreactNativeArchitectures=arm64-v8a
```

It turns the screen off, accelerates 20 automatic transitions by seeking near each end, measures car/native metadata and clock agreement, then restores the starting occurrence, position, repeat mode, and playback state. Timing results use the `AstraCarAcceptance` log tag. No pause/play is issued between transitions. Without the explicit target argument this test is skipped.

On September 5, 2026, this test passed on a Galaxy S22 Ultra running Android 16 with the Desktop Head Unit connected. All 20 transitions had matching metadata within the same 25 ms polling interval; the maximum measured progress difference was 13 ms. The test seeks to five seconds before each track ends, so this is an accelerated transition check, not a full-duration listening run. Native tests additionally run 21 short WAV items without creating React, and cover EQ channel-count changes, stale snapshots, occurrence selection beyond 500 rows, and local/remote artwork. Typecheck, lint, the TypeScript suites listed above, EQ math, native unit tests, four car instrumentation tests, two player/DSP instrumentation tests, all 28 Room repository tests, and Android debug/preview builds passed.

DHU browsing, artwork, queue display, shuffle, repeat, and media keys were exercised. A reconnect restored the paused card before Android Auto sent an explicit `MediaSessionRecord:play` request (confirmed by the system log). Astra honors that request; disable the host's automatic music-start setting when checking that connection alone stays paused.

The September 8 browsing update passed typecheck, lint, car/queue/session TypeScript tests, nine car unit tests, eight car instrumentation tests, 51 library unit tests, and the preview build. New Room fixtures cover complete alphabetical traversal, crowded letters, accents and other scripts, artist albums, favorite changes, ordered playlist subdivisions, legacy folder IDs, and custom action limits. DHU inspection on the connected phone confirmed the letter menus, named subdivisions, artist album pages, and current-song-first Queue view.

Before release, also verify a physical head unit with 20 uninterrupted full-track transitions, cold launch, paused reconnect, network loss/recovery, source credential changes, steering-wheel controls, queue selection beyond the native window, and enqueue order. Check notification/Bluetooth behavior, widgets, and DSP. When testing an APK update while Android Auto is connected, reconnect projection so the host reloads drawable resources instead of cached IDs from the previous APK.

## References

- [Android artwork guidance](https://developer.android.com/training/cars/media/create-media-browser/media-artwork)
- [Android custom browse action protocol](https://developer.android.com/training/cars/media/create-media-browser/custom-browse-actions)

These implementations informed the native player/session approach. Astra keeps its existing engine rather than migrating to Media3 in this change.
