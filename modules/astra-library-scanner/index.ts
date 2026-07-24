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

export interface EmbeddedLyricsSyncText {
  timestampMs: number;
  text: string;
}

/** Embedded lyrics read from container tags without decoding audio. */
export type EmbeddedLyricsReadResult =
  | {
      status: 'hit';
      text: string | null;
      syncText: EmbeddedLyricsSyncText[];
    }
  | { status: 'missing' }
  | { status: 'unavailable' };

export interface ScanProgressEvent {
  phase: 'discovering' | 'extracting' | 'indexing';
  found?: number;
  processed?: number;
  total?: number;
  folderName?: string;
}

export interface NativeScanResult {
  added: number;
  updated: number;
  removed: number;
  errors: number;
  total: number;
  catalogRevision: string;
}

type AstraLibraryScannerEvents = {
  onScanProgress: (event: ScanProgressEvent) => void;
};

declare class AstraLibraryScannerModuleType extends NativeModule<AstraLibraryScannerEvents> {
  listAudioFiles(treeUri: string, extensions: string[]): Promise<ListResult>;
  extractMetadata(files: { uri: string; coverUri?: string | null }[]): Promise<ExtractedMetadata[]>;
  scanFolderNative(
    folderId: number,
    mode: 'incremental' | 'full',
    extensions: string[]
  ): Promise<NativeScanResult>;
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
   * Read embedded lyrics from Vorbis, ID3 (USLT/SYLT/TXXX), and MP4/M4A tags
   * without decoding audio. `missing` means metadata was read successfully but
   * no supported tag was present; `unavailable` preserves cache on I/O failure.
   */
  readEmbeddedLyrics(uri: string): Promise<EmbeddedLyricsReadResult>;
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

export type LibraryStatus =
  | 'initializing'
  | 'empty'
  | 'ready'
  | 'scanning'
  | 'rebuilding'
  | 'degraded'
  | 'fatalUserData';

export interface LibraryStatusSnapshot {
  status: LibraryStatus;
  catalogRevision: string;
  trackCount: number;
  message: string | null;
  recoveryNotice: string | null;
}

export interface NativePage<T> {
  items: T[];
  nextCursor: string | null;
  previousCursor: string | null;
  totalCount: number;
  catalogRevision: string;
  error?: 'STALE_REVISION';
}

export type LibraryQuery =
  | { kind: 'library'; sort: 'artist' | 'title' | 'recently_added' | 'duration' }
  | { kind: 'album'; albumKey: string }
  | {
      kind: 'artist';
      artistKey: string;
      groupingMode: 'astra' | 'fileTags';
      section: 'songs' | 'appearances' | 'all';
    }
  | { kind: 'folder'; folderNodeId?: string; folderId?: number }
  | { kind: 'playlist'; playlistId: number }
  | { kind: 'favorites' }
  | { kind: 'recent' }
  | { kind: 'search'; query: string }
  | { kind: 'manual'; paths: string[] }
  | { kind: 'dynamicPlaylist'; playlistId: number };

export interface NativePlaybackWindow<T> {
  sessionId: string;
  items: (T & { queuePosition: number })[];
  windowStart: number;
  activePosition: number;
  totalCount: number;
  contextJson: string;
  shuffleSeed: number | null;
  catalogRevision: string;
}

export interface LibrarySectionAnchor {
  label: string;
  cursor: string;
}

export interface NativeFolderNode {
  id: string;
  folderId: number;
  parentNodeId: string | null;
  name: string;
  depth: number;
  directTrackCount: number;
  totalTrackCount: number;
  available: boolean;
  catalogRevision: string;
}

export interface NativeTrackLoudness {
  path: string;
  loudness_lufs: number | null;
  sample_peak: number | null;
  replay_gain_track_db: number | null;
  replay_gain_album_db: number | null;
  replay_gain_track_peak: number | null;
  replay_gain_album_peak: number | null;
  rg_scanned: number;
}

export interface NativeLibraryLoudnessStats {
  lufsCount: number;
  medianLufs: number | null;
  rgCount: number;
  medianRgTrackDb: number | null;
}

type AstraLibraryDataEvents = {
  onLibraryStatus: (event: LibraryStatusSnapshot) => void;
  onScanProgress: (event: {
    scanId: string;
    phase: 'discovering' | 'extracting' | 'publishing';
    processed: number;
    total: number;
    folderName: string;
  }) => void;
  onCatalogChanged: (event: { catalogRevision: string }) => void;
};

declare class AstraLibraryDataModuleType extends NativeModule<AstraLibraryDataEvents> {
  initialize(): Promise<LibraryStatusSnapshot>;
  getCurrentStatus(): LibraryStatusSnapshot;
  getSettings(keys: string[]): Promise<Record<string, string | null>>;
  setSettings(values: Record<string, string | null>): Promise<void>;
  listFolders(): Promise<Record<string, unknown>[]>;
  getFolderNodes(parentNodeId: string | null): Promise<NativeFolderNode[]>;
  getFolderTracks<T>(
    nodeId: string,
    offset: number,
    limit: number
  ): Promise<{
    items: T[];
    nextOffset: number | null;
    totalCount: number;
    catalogRevision: string;
  }>;
  registerFolder(treeUri: string, displayName: string): Promise<Record<string, unknown>>;
  removeFolder(folderId: number): Promise<void>;
  getTrackPage<T>(
    sort: 'artist' | 'title' | 'recently_added' | 'duration',
    cursor: string | null,
    limit: number
  ): Promise<NativePage<T>>;
  getTrack<T>(path: string): Promise<T | null>;
  getTrackLoudness(paths: string[]): Promise<NativeTrackLoudness[]>;
  setTrackLoudness(path: string, lufs: number | null, samplePeak: number | null): Promise<void>;
  setTrackReplayGain(
    path: string,
    trackGainDb: number | null,
    albumGainDb: number | null,
    trackPeak: number | null,
    albumPeak: number | null
  ): Promise<void>;
  getLibraryLoudnessStats(): Promise<NativeLibraryLoudnessStats>;
  getWaveform(path: string): Promise<number[] | null>;
  putWaveform(path: string, peaks: number[]): Promise<void>;
  countWaveforms(): Promise<number>;
  clearWaveforms(): Promise<void>;
  getLyrics<T>(path: string, metadataSignature: string): Promise<T | null>;
  putLyrics(path: string, values: Record<string, unknown>): Promise<void>;
  deleteLyrics(path: string): Promise<void>;
  countLyrics(): Promise<number>;
  clearLyrics(): Promise<void>;
  readMobileSession(): Promise<string | null>;
  writeMobileSession(snapshotJson: string): Promise<void>;
  createPlaybackContext<T>(
    context: LibraryQuery,
    anchorPath: string | null,
    shuffle: boolean,
    seed: number | null
  ): Promise<NativePlaybackWindow<T>>;
  getPlaybackWindow<T>(
    sessionId: string,
    start: number,
    limit: number
  ): Promise<NativePlaybackWindow<T>>;
  updatePlaybackPosition(sessionId: string, activePosition: number): Promise<void>;
  restorePlaybackContext<T>(): Promise<NativePlaybackWindow<T> | null>;
  mutatePlaybackContext<T>(
    operation:
      | 'insertAfterActive'
      | 'append'
      | 'insertQueryAfterActive'
      | 'appendQuery'
      | 'remove'
      | 'move'
      | 'moveManyAfterActive'
      | 'shuffle',
    values: Record<string, unknown>
  ): Promise<NativePlaybackWindow<T> | null>;
  recordTrackPlayed(path: string): Promise<boolean>;
  getRecentlyPlayed<T>(limit: number): Promise<T[]>;
  listRemoteSources<T>(): Promise<T[]>;
  getRemoteSource<T>(sourceId: number): Promise<T | null>;
  createRemoteSource<T>(
    type: 'subsonic' | 'jellyfin',
    name: string,
    baseUrl: string,
    username: string,
    enabled: boolean
  ): Promise<T>;
  updateRemoteSource(sourceId: number, fields: Record<string, unknown>): Promise<void>;
  setRemoteSourceStatus(sourceId: number, status: string, error: string | null): Promise<void>;
  deleteRemoteSource(sourceId: number, purgeCatalog: boolean): Promise<void>;
  replaceRemoteUserState(
    sourceId: number,
    sourceType: 'subsonic' | 'jellyfin',
    favoritePaths: string[],
    playlists: Record<string, unknown>[]
  ): Promise<void>;
  beginRemoteSync(sourceId: number, sourceType: 'subsonic' | 'jellyfin'): Promise<string>;
  appendRemoteTracks(syncId: string, rows: Record<string, unknown>[]): Promise<number>;
  commitRemoteSync(
    syncId: string
  ): Promise<{ tracksScanned: number; removed: number; catalogRevision: string }>;
  abortRemoteSync(syncId: string): Promise<void>;
  listPlaylists<T>(): Promise<T[]>;
  createPlaylist<T>(name: string, kind: 'normal' | 'dynamic', rulesJson: string | null): Promise<T>;
  getDynamicPlaylistRules(playlistId: number): Promise<string>;
  updateDynamicPlaylistRules(playlistId: number, rulesJson: string): Promise<void>;
  previewDynamicPlaylist<T>(rulesJson: string): Promise<T>;
  renamePlaylist(playlistId: number, name: string): Promise<void>;
  deletePlaylist(playlistId: number): Promise<void>;
  markPlaylistPlayed(playlistId: number): Promise<void>;
  addPlaylistEntries(
    playlistId: number,
    entries: {
      trackPath: string;
      fallbackTitle?: string | null;
      fallbackArtist?: string | null;
      fallbackAlbum?: string | null;
    }[]
  ): Promise<number>;
  removePlaylistEntry(playlistId: number, path: string): Promise<void>;
  movePlaylistEntry(playlistId: number, path: string, direction: -1 | 1): Promise<void>;
  getPlaylistEntries<T>(
    playlistId: number,
    offset: number,
    limit: number
  ): Promise<{ items: T[]; nextOffset: number | null; totalCount: number }>;
  getFavoritePaths(): Promise<string[]>;
  getFavoriteTracks<T>(limit: number): Promise<T[]>;
  setFavorite(path: string, favorite: boolean): Promise<void>;
  getDesktopSyncState<T>(): Promise<T>;
  applyDesktopSyncPlan<T>(plan: Record<string, unknown>): Promise<T>;
  resolveDesktopSyncConflict(
    conflict: Record<string, unknown>,
    resolution: 'desktop' | 'phone' | 'both' | 'merge',
    mergedPlaylist: Record<string, unknown> | null
  ): Promise<void>;
  clearDesktopSyncBaselines(): Promise<void>;
  getAlbumPage<T>(
    sort: 'artist' | 'name' | 'recently_added' | 'year',
    includeSingles: boolean,
    cursor: string | null,
    limit: number
  ): Promise<NativePage<T>>;
  getArtistPage<T>(
    sort: 'name' | 'track_count',
    groupingMode: 'astra' | 'fileTags',
    includeCollaborations: boolean,
    cursor: string | null,
    limit: number
  ): Promise<NativePage<T>>;
  getAlbumDetail<T, S = Record<string, unknown>>(
    albumKey: string,
    cursor: string | null,
    limit: number
  ): Promise<NativePage<T> & { summary: S | null }>;
  getArtistDetail<T, S = Record<string, unknown>>(
    artistKey: string,
    groupingMode: 'astra' | 'fileTags',
    section: 'songs' | 'appearances' | 'all',
    cursor: string | null,
    limit: number
  ): Promise<NativePage<T> & { summary: S | null }>;
  getArtistAlbums<T>(
    artistKey: string,
    groupingMode: 'astra' | 'fileTags',
    offset: number,
    limit: number
  ): Promise<{
    items: T[];
    nextOffset: number | null;
    totalCount: number;
    catalogRevision: string;
  }>;
  searchTracks<T>(query: string, limit: number): Promise<T[]>;
  searchLibrary<TTrack, TAlbum, TArtist>(
    query: string,
    limit: number,
    includeSingles: boolean,
    groupingMode: 'astra' | 'fileTags',
    includeCollaborations: boolean
  ): Promise<{ tracks: TTrack[]; albums: TAlbum[]; artists: TArtist[] }>;
  matchSignal<T>(
    title: string,
    artist: string,
    durationSeconds: number | null
  ): Promise<{
    kind: 'match' | 'ambiguous' | 'none';
    candidates: { track: T; match: 'exact' | 'normalized'; durationDeltaSec: number | null }[];
  }>;
  getSectionAnchors(
    kind: 'tracks' | 'albums' | 'artists',
    sort: 'artist' | 'title' | 'name',
    includeSingles: boolean,
    groupingMode: 'astra' | 'fileTags',
    includeCollaborations: boolean
  ): Promise<LibrarySectionAnchor[]>;
  flushUserSnapshot(): Promise<void>;
}

export const AstraLibraryData =
  requireNativeModule<AstraLibraryDataModuleType>('AstraLibraryData');
