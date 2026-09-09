# Selection animation reliability

`FORCE_REACT_RENDER_FOR_SETTLED_ANIMATIONS` is explicitly disabled in
`package.json`. Reanimated 4.3.1 can discard completed animated styles before
syncing them back to React when the JS thread misses its cleanup window. A later
render can restore initial opacity/geometry even though selection remains correct.
See [the upstream report](https://github.com/software-mansion/react-native-reanimated/issues/9965).
Keep this workaround until a replacement is validated on a native build;
changing a static flag requires rebuilding the app.

## Controlled device reproduction

Validated on a Samsung SM-S908U1, Android, with React Native 0.85.3,
Reanimated 4.3.1, and Worklets 0.8.3. Both builds used the same fixed selection
helper and `ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS: true`.

A temporary screen rendered the actual SegmentedControl, LibraryContextBar,
and TabBar with controlled selections and a separate opacity sentinel:

1. Fade the sentinel from 0 to 1 over 400ms.
2. At 200ms select Graphic, Artists, and EQ.
3. At 1000ms block JavaScript for 2200ms, spanning the settled-style cleanup window.
4. At 3600ms trigger an unrelated React state update.
5. Capture the settled screen and native accessibility bounds after six seconds.

| Native settled-animation flag | Result |
| --- | --- |
| `true`, production-mode preview | All three selection indicators and the sentinel disappear; selected labels/state remain correct. |
| `false`, production-mode preview | All indicators and the sentinel remain visible in the correct positions. |
| `false`, debug | Same passing result. |

Screenshots were checked visually and by comparing indicator pixels with selected
native control bounds. Checking shared values or accessibility selection alone
would miss the failure. The diagnostic route and Gradle comparison overrides
were temporary and are excluded from the delivered app.

## Geometry regression coverage

`selectionSlideState.test.mts` tests the state transitions used by the hook:
layout before/after first commit, shape/axis changes, late events across A→B→A,
rapid selection, in-flight label resizing, settled layout correction, toolbar
hide/show, invalid geometry, and unmount/effect replay. Each measured surface has
its own cache and generation; consumers key their measured native subtree with
`surfaceKey` so a new surface always reports layout.

Device checks also covered real Library/EQ navigation, portrait/landscape changes,
toolbar restoration, background/resume, sleep/wake, and reduced motion. Native
debug validation used the Astra Dev package ID through a temporary Gradle override
because the regular installed app has a different signing key.

## Final checks and performance spot check

- Navigation: 142 tests passed (including 13 new lifecycle cases).
- Library layout: 34 tests passed; EQ layout: 10 tests passed.
- Typecheck, lint, and patch whitespace checks passed.
- Final production-mode APK: 60/60 pixel assertions passed across all five
  Library sections, return to Albums, and the actual Equalizer screen.
- The final source map excludes the diagnostic route. Native library hashes
  confirm the APK contains the CMake output built with the flag disabled.

The same four-swipe Tracks sequence produced 10/12/13/14ms at the
50th/90th/95th/99th frame-time percentiles before and after. Reported janky frames
varied from 28/197 (14.21%) to 36/195 (18.46%); this short sample is not a
performance benchmark.

Total PSS was about 690MiB before and 655MiB after. Native heap and graphics PSS
were higher afterward, and swap PSS differed substantially (about 289MiB before
versus less than 1MiB after). The sessions had different cache/residency histories,
so these samples cannot establish the flag's memory cost. Both total-PSS samples
exceeded the profiling script's existing 400MiB target; they are observations,
not a memory acceptance pass.
