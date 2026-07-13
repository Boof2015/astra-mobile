import { create } from 'zustand';
import { openLibraryDb } from '@/db/database';
import { getSetting, setSetting } from '@/db/queries';
import type { ArtistGroupingMode } from '@/library/artistGrouping';
import {
  parseNowPlayingCompanion,
  type NowPlayingCompanion,
} from '@/components/player/nowPlayingPreferences';

/**
 * Persisted app preferences. SQLite (settings table) is the source of truth — this
 * store mirrors it in memory. Kept free of cross-store imports; libraryStore
 * subscribes here to recompute the artist list when the grouping mode changes.
 */
const ARTIST_GROUPING_KEY = 'artist_grouping_mode';
const INCLUDE_SINGLES_KEY = 'album_include_singles';
const SCOPE_MODE_KEY = 'scope_mode';
const SCOPE_STAGE_VISIBLE_KEY = 'scope_stage_visible';
const SCOPE_STYLE_KEY = 'now_playing_scope_style';
const LYRICS_VISIBLE_KEY = 'lyrics_visible';
const NOW_PLAYING_COMPANION_KEY = 'now_playing_companion';

/** Which visualizer the now-playing scope stage shows. */
export type ScopeMode = 'spectrum' | 'scope';

/**
 * Where the now-playing scopes live: 'rail' keeps a strip below the artwork
 * (art shrinks to fit), 'rack' flips the art card's face to both scopes
 * stacked over a dimmed artwork backdrop (art size never changes).
 */
export type NowPlayingScopeStyle = 'rail' | 'rack';

function parseGroupingMode(value: string | null): ArtistGroupingMode {
  return value === 'fileTags' ? 'fileTags' : 'astra';
}

function parseScopeMode(value: string | null): ScopeMode {
  return value === 'scope' ? 'scope' : 'spectrum';
}

function parseScopeStyle(value: string | null): NowPlayingScopeStyle {
  return value === 'rack' ? 'rack' : 'rail';
}

function parseBoolean(value: string | null): boolean {
  return value === 'true';
}

interface SettingsStore {
  artistGroupingMode: ArtistGroupingMode;
  /** Show 1-track albums in the Albums view (desktop parity default: hidden). */
  includeSingles: boolean;
  scopeMode: ScopeMode;
  scopeStageVisible: boolean;
  nowPlayingScopeStyle: NowPlayingScopeStyle;
  /** Whether the now-playing top half shows lyrics instead of art/scope. */
  lyricsVisible: boolean;
  nowPlayingCompanion: NowPlayingCompanion;
  loaded: boolean;
  load: () => Promise<void>;
  setArtistGroupingMode: (mode: ArtistGroupingMode) => Promise<void>;
  setIncludeSingles: (include: boolean) => Promise<void>;
  setScopeMode: (mode: ScopeMode) => Promise<void>;
  setScopeStageVisible: (visible: boolean) => Promise<void>;
  setNowPlayingScopeStyle: (style: NowPlayingScopeStyle) => Promise<void>;
  setLyricsVisible: (visible: boolean) => Promise<void>;
  setNowPlayingCompanion: (companion: NowPlayingCompanion) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  artistGroupingMode: 'astra',
  includeSingles: false,
  scopeMode: 'spectrum',
  scopeStageVisible: false,
  nowPlayingScopeStyle: 'rail',
  lyricsVisible: false,
  nowPlayingCompanion: 'queue',
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    const db = await openLibraryDb();
    const [
      grouping,
      includeSingles,
      scope,
      scopeStageVisible,
      scopeStyle,
      lyricsVisible,
      nowPlayingCompanion,
    ] = await Promise.all([
      getSetting(db, ARTIST_GROUPING_KEY),
      getSetting(db, INCLUDE_SINGLES_KEY),
      getSetting(db, SCOPE_MODE_KEY),
      getSetting(db, SCOPE_STAGE_VISIBLE_KEY),
      getSetting(db, SCOPE_STYLE_KEY),
      getSetting(db, LYRICS_VISIBLE_KEY),
      getSetting(db, NOW_PLAYING_COMPANION_KEY),
    ]);
    set({
      artistGroupingMode: parseGroupingMode(grouping),
      includeSingles: parseBoolean(includeSingles),
      scopeMode: parseScopeMode(scope),
      scopeStageVisible: parseBoolean(scopeStageVisible),
      nowPlayingScopeStyle: parseScopeStyle(scopeStyle),
      lyricsVisible: parseBoolean(lyricsVisible),
      nowPlayingCompanion: parseNowPlayingCompanion(nowPlayingCompanion),
      loaded: true,
    });
  },

  setArtistGroupingMode: async (mode) => {
    if (get().artistGroupingMode === mode) return;
    set({ artistGroupingMode: mode });
    const db = await openLibraryDb();
    await setSetting(db, ARTIST_GROUPING_KEY, mode);
  },

  setIncludeSingles: async (include) => {
    if (get().includeSingles === include) return;
    set({ includeSingles: include });
    const db = await openLibraryDb();
    await setSetting(db, INCLUDE_SINGLES_KEY, include ? 'true' : 'false');
  },

  setScopeMode: async (mode) => {
    if (get().scopeMode === mode) return;
    set({ scopeMode: mode });
    const db = await openLibraryDb();
    await setSetting(db, SCOPE_MODE_KEY, mode);
  },

  setScopeStageVisible: async (visible) => {
    if (get().scopeStageVisible === visible) return;
    set({ scopeStageVisible: visible });
    const db = await openLibraryDb();
    await setSetting(db, SCOPE_STAGE_VISIBLE_KEY, visible ? 'true' : 'false');
  },

  setNowPlayingScopeStyle: async (style) => {
    if (get().nowPlayingScopeStyle === style) return;
    set({ nowPlayingScopeStyle: style });
    const db = await openLibraryDb();
    await setSetting(db, SCOPE_STYLE_KEY, style);
  },

  setLyricsVisible: async (visible) => {
    if (get().lyricsVisible === visible) return;
    set({ lyricsVisible: visible });
    const db = await openLibraryDb();
    await setSetting(db, LYRICS_VISIBLE_KEY, visible ? 'true' : 'false');
  },

  setNowPlayingCompanion: async (companion) => {
    if (get().nowPlayingCompanion === companion) return;
    set({ nowPlayingCompanion: companion });
    const db = await openLibraryDb();
    await setSetting(db, NOW_PLAYING_COMPANION_KEY, companion);
  },
}));
