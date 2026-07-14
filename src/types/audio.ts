// Core audio types — ported from desktop `src/renderer/types/audio.ts`.
// Kept field-for-field so desktop logic (queue, EQ, library) ports cleanly later.

// Track metadata
export interface Track {
  id: string;
  path: string;
  origin?: 'library' | 'associated-external';
  title: string;
  artist: string;
  artistNames?: string[];
  album: string;
  albumArtist?: string;
  albumArtistNames?: string[];
  albumIdentityKey?: string;
  duration: number;
  trackNumber?: number;
  discNumber?: number;
  year?: number;
  genre?: string;
  artworkData?: string; // Base64 data URL (for files opened directly)
  artworkHash?: string; // Hash for cached artwork (for library tracks)
  format: string;
  sampleRate?: number;
  bitDepth?: number;
  bitrate?: number;
  channels?: number;
  codec?: string;
  codecProfile?: string;
  isAtmosJoc?: boolean;
  replayGainTrackDb?: number;
  replayGainAlbumDb?: number;
  sourceType?: 'local' | 'subsonic' | 'jellyfin';
  sourceId?: number;
  sourceTrackId?: string;
  sourcePath?: string;
  /** Server cover-art id for remote tracks (resolved to a URL via remoteUrls). */
  artworkSourceId?: string;
  isAvailable?: boolean;
  availabilityReason?: string;
}

// Playback state
export type PlaybackState = 'stopped' | 'playing' | 'paused' | 'loading';

// Player store state (subset realized at M0; expands toward desktop PlayerStore)
export interface PlayerState {
  currentTrack: Track | null;
  playbackState: PlaybackState;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
}

// EQ Band
export type EQBandType = 'lowshelf' | 'peaking' | 'highshelf' | 'highpass' | 'lowpass';

export interface EQBand {
  id: string;
  type: EQBandType;
  frequency: number;
  gain: number;
  Q: number;
  // Per-band bypass (mobile addition vs desktop — the EQ screen's per-band On toggle).
  // A disabled band is passthrough and is skipped in the response curve.
  enabled: boolean;
}

// EQ editor mode — graphic is a fixed 5-band front-end compiled onto the same
// parametric engine (see src/audio/graphicEq.ts).
export type EQMode = 'parametric' | 'graphic';

// EQ Preset
export interface EQPreset {
  id: string;
  name: string;
  bands: EQBand[];
  preamp: number;
  isCustom?: boolean;
  // Which editor the preset targets; absent = 'parametric' (pre-mode presets).
  mode?: EQMode;
  // Slider gains (dB) when mode === 'graphic'; `bands` then holds the compiled
  // snapshot so older builds / missing gains degrade to an identical parametric preset.
  graphicGains?: number[];
}

export type AudioOutputRouteKind =
  | 'speaker'
  | 'wired'
  | 'bluetooth'
  | 'usb'
  | 'hdmi'
  | 'remote'
  | 'unknown';

export interface AudioOutputRoute {
  key: string;
  label: string;
  kind: AudioOutputRouteKind;
  nativeType: number | null;
  nativeId: number | null;
  selectedRouteName: string | null;
  updatedAt: number;
}

// Visualizer config (scopes land at M3)
export interface VisualizerConfig {
  type: 'oscilloscope' | 'spectrum' | 'spectrogram' | 'vu' | 'loudness' | 'stereo';
  fftSize: 1024 | 2048 | 4096 | 8192 | 16384;
  pitchLock?: boolean;
  scale?: 'linear' | 'log' | 'mel';
}
