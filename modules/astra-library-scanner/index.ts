import { requireNativeModule, type NativeModule } from 'expo-modules-core';

/** A single audio file found during the SAF tree walk. */
export interface ScannedFile {
  /** SAF document URI — playable directly by ExoPlayer and readable by MMR. */
  uri: string;
  name: string;
  size: number | null;
  lastModified: number;
  mimeType: string | null;
  /** Document URI of the containing directory (key into `ListResult.covers`). */
  parentUri: string;
}

export interface ListResult {
  files: ScannedFile[];
  /** Best external cover-art candidate per directory (cover/folder/front/albumart). */
  covers: Record<string, string>;
}

export interface ExtractedMetadata {
  uri: string;
  ok: boolean;
  error?: string;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  albumArtist?: string | null;
  genre?: string | null;
  /** Container mime type reported by MediaMetadataRetriever. */
  mimeType?: string | null;
  /** Audio track mime type from MediaExtractor (e.g. "audio/flac"). */
  codecMime?: string | null;
  durationMs?: number | null;
  bitrate?: number | null;
  trackNumber?: number | null;
  discNumber?: number | null;
  year?: number | null;
  sampleRate?: number | null;
  channels?: number | null;
  bitsPerSample?: number | null;
  /** File name in the artwork cache dir: `md5(bytes) + extension`. */
  artworkHash?: string | null;
}

/** ReplayGain tags read from a file's container (null = tag absent). */
export interface ReplayGainTags {
  trackGainDb: number | null;
  albumGainDb: number | null;
  trackPeak: number | null;
  albumPeak: number | null;
}

/** A `.xlrc`/`.lrc` file found next to the track. */
export interface SidecarLyrics {
  text: string;
  format: 'xlrc' | 'lrc';
}

/** Embedded lyrics text read from container tags. */
export interface EmbeddedLyrics {
  text: string;
}

export interface ScanProgressEvent {
  phase: 'discovering';
  found: number;
}

type AstraLibraryScannerEvents = {
  onScanProgress: (event: ScanProgressEvent) => void;
};

declare class AstraLibraryScannerModuleType extends NativeModule<AstraLibraryScannerEvents> {
  listAudioFiles(treeUri: string, extensions: string[]): Promise<ListResult>;
  extractMetadata(files: { uri: string; coverUri?: string | null }[]): Promise<ExtractedMetadata[]>;
  /**
   * Decode the file's PCM and return `bins` RMS peaks normalized to [0,1] for
   * the waveform seek bar. Whole-file decode (heavy); returns [] on failure.
   */
  extractWaveform(uri: string, bins: number): Promise<number[]>;
  /**
   * Decode short windows across the file and return approximate RMS peaks for
   * immediate seek-bar paint. Cheap preview only; callers should not persist it.
   */
  extractWaveformPreview(uri: string, bins: number): Promise<number[]>;
  /**
   * Fast integrated loudness (M4): decodes only a few short windows across the
   * track + gated K-weighting -> integrated LUFS + absolute sample peak. Null on
   * failure / unmeasurable audio. Waveform peaks are separate (extractWaveform).
   */
  measureLoudness(uri: string): Promise<{ lufs: number | null; peak: number | null }>;
  /**
   * Read ReplayGain track/album gain (dB) + peak (linear) from container tags
   * (ID3 TXXX / Vorbis comments / MP4 freeform) without decoding audio. All fields
   * are null when the tag is absent; the whole call is cheap (metadata only).
   */
  readReplayGain(uri: string): Promise<ReplayGainTags>;
  /**
   * Look for a sibling lyrics file next to the track (`<name>.xlrc` preferred, then
   * `<name>.lrc`) and return its text + format, or null. Read fresh on demand so
   * files authored after a scan are picked up.
   */
  readSidecarLyrics(uri: string): Promise<SidecarLyrics | null>;
  /**
   * Read embedded lyrics from container tags (Vorbis LYRICS/UNSYNCEDLYRICS for
   * FLAC/Ogg/Opus, TXXX:LYRICS, MP4 lyric atoms) without decoding audio. Null when
   * absent. ID3 USLT/SYLT are not covered (ExoPlayer leaves them undecoded).
   */
  readEmbeddedLyrics(uri: string): Promise<EmbeddedLyrics | null>;
  getArtworkDirPath(): string;
  getArtworkThumbDirPath(): string;
  ensureArtworkThumbnails(hashes: string[]): Promise<number>;
  getPersistedTreeUris(): string[];
  takePersistableUriPermission(uri: string): Promise<boolean>;
  releasePersistedUriPermission(uri: string): Promise<void>;
  /**
   * Scan keepalive (Android). `startScanService` promotes a `dataSync` foreground
   * service + partial wakelock so a JS-orchestrated scan keeps running when the app
   * is backgrounded / the screen sleeps, and shows a progress notification;
   * `updateScanNotification` refreshes it; `stopScanService` tears it down. The
   * wakelock/keepalive work even if the notification itself is not permitted.
   */
  startScanService(title: string, text: string): void;
  updateScanNotification(
    title: string,
    text: string,
    subText: string | null,
    current: number,
    total: number,
    indeterminate: boolean
  ): void;
  stopScanService(): void;
}

export const AstraLibraryScanner =
  requireNativeModule<AstraLibraryScannerModuleType>('AstraLibraryScanner');
