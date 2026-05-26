# Astra Mobile

A standalone, Android-first audiophile music player — the mobile counterpart to desktop [Astra](../astra), built as its own independent app (no pairing, no desktop dependency). See [DESIGN.md](DESIGN.md) for the full direction and roadmap.

## Status: M0 — Skeleton ✅

The foundational app runs end-to-end on Android:

- **Design system** ported from desktop Astra — black base, cyan accent (`#38bdf8`), Inter + JetBrains Mono, the `ASTRA` wordmark, and `FLAC`/`24-bit`/`48.0 kHz` format badges (`src/theme`, `src/components`).
- **Navigation shell** — bottom tabs (Home / Library / EQ) with a persistent **mini-player** glued above the bar, plus a swipe-up **now-playing** modal (`src/app`).
- **Playback** via [`react-native-track-player`](https://rntp.dev) (Media3/ExoPlayer) — verified playing on an emulator with a live MediaSession (lock-screen / notification / Bluetooth / Android Auto controls), background playback, and live progress (`src/audio`).
- **State** — Zustand stores mirroring desktop shapes (`src/stores`), typed with ported core models (`src/types`).

Library scanning, scopes, EQ DSP, remote sources, and Last.fm are later milestones (M1–M7 in DESIGN.md).

## Stack

Expo SDK 56 · React Native 0.85 (New Architecture / bridgeless) · expo-router · TypeScript · Zustand · react-native-track-player · react-native-svg.

## Prerequisites

- Node 20.19+/22.13+/24.3+ (Node 23 works but emits engine warnings)
- JDK 17, Android SDK + an emulator/device (`ANDROID_HOME` exported)

## Run

```bash
npm install                 # also applies patches (see below) via postinstall
npm run android             # = expo run:android — builds a dev client, installs, launches
```

The first native build downloads Gradle + the NDK/CMake and takes several minutes; subsequent builds are seconds. `npm run typecheck` runs `tsc --noEmit`.

## Patches — RNTP on the New Architecture

`react-native-track-player@4.1.2` predates RN 0.85's bridgeless-only requirement, so it needs three source fixes, captured in `patches/react-native-track-player+4.1.2.patch` and applied automatically by `patch-package` on install:

1. **Compile** — `Arguments.fromBundle()` now requires a non-null `Bundle` → null-safe calls.
2. **TurboModule registration** — `@ReactMethod` functions written as `= scope.launch { … }` return `Job`, which the new-arch interop rejects (non-void ⇒ treated as synchronous) → converted to block bodies returning `Unit`.
3. **Event emit (bridgeless)** — `MusicService.emit/emitList` used the legacy `reactNativeHost.reactInstanceManager`, which throws under the New Architecture → switched to `reactHost.currentReactContext`.

Additionally, player setup is deferred to the first play action (a foreground gesture) rather than app launch, because RNTP starts a foreground MediaSession service on setup and Android only permits that while the app is foregrounded (`src/audio/playbackController.ts`).
