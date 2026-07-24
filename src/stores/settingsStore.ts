import { create } from 'zustand';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import type { ArtistGroupingMode } from '@/library/artistGrouping';
import {
  parseNowPlayingCompanion,
  type NowPlayingCompanion,
} from '@/components/player/nowPlayingPreferences';
import {
  parseHomeGreetingTextMode,
  type HomeGreetingTextMode,
} from '@/home/homeGreeting';

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
const HOME_GREETING_TEXT_MODE_KEY = 'home_greeting_text_mode';

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
  homeGreetingTextMode: HomeGreetingTextMode;
  loaded: boolean;
  load: () => Promise<void>;
  setArtistGroupingMode: (mode: ArtistGroupingMode) => Promise<void>;
  setIncludeSingles: (include: boolean) => Promise<void>;
  setScopeMode: (mode: ScopeMode) => Promise<void>;
  setScopeStageVisible: (visible: boolean) => Promise<void>;
  setNowPlayingScopeStyle: (style: NowPlayingScopeStyle) => Promise<void>;
  setLyricsVisible: (visible: boolean) => Promise<void>;
  setNowPlayingCompanion: (companion: NowPlayingCompanion) => Promise<void>;
  setHomeGreetingTextMode: (mode: HomeGreetingTextMode) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  artistGroupingMode: 'astra',
  includeSingles: false,
  scopeMode: 'spectrum',
  scopeStageVisible: false,
  nowPlayingScopeStyle: 'rail',
  lyricsVisible: false,
  nowPlayingCompanion: 'queue',
  homeGreetingTextMode: 'messages',
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    await AstraLibraryData.initialize();
    const values = await AstraLibraryData.getSettings([
      ARTIST_GROUPING_KEY,
      INCLUDE_SINGLES_KEY,
      SCOPE_MODE_KEY,
      SCOPE_STAGE_VISIBLE_KEY,
      SCOPE_STYLE_KEY,
      LYRICS_VISIBLE_KEY,
      NOW_PLAYING_COMPANION_KEY,
      HOME_GREETING_TEXT_MODE_KEY,
    ]);
    const grouping = values[ARTIST_GROUPING_KEY] ?? null;
    const includeSingles = values[INCLUDE_SINGLES_KEY] ?? null;
    const scope = values[SCOPE_MODE_KEY] ?? null;
    const scopeStageVisible = values[SCOPE_STAGE_VISIBLE_KEY] ?? null;
    const scopeStyle = values[SCOPE_STYLE_KEY] ?? null;
    const lyricsVisible = values[LYRICS_VISIBLE_KEY] ?? null;
    const nowPlayingCompanion = values[NOW_PLAYING_COMPANION_KEY] ?? null;
    const homeGreetingTextMode = values[HOME_GREETING_TEXT_MODE_KEY] ?? null;
    set({
      artistGroupingMode: parseGroupingMode(grouping),
      includeSingles: parseBoolean(includeSingles),
      scopeMode: parseScopeMode(scope),
      scopeStageVisible: parseBoolean(scopeStageVisible),
      nowPlayingScopeStyle: parseScopeStyle(scopeStyle),
      lyricsVisible: parseBoolean(lyricsVisible),
      nowPlayingCompanion: parseNowPlayingCompanion(nowPlayingCompanion),
      homeGreetingTextMode: parseHomeGreetingTextMode(homeGreetingTextMode),
      loaded: true,
    });
  },

  setArtistGroupingMode: async (mode) => {
    if (get().artistGroupingMode === mode) return;
    set({ artistGroupingMode: mode });
    await AstraLibraryData.setSettings({ [ARTIST_GROUPING_KEY]: mode });
  },

  setIncludeSingles: async (include) => {
    if (get().includeSingles === include) return;
    set({ includeSingles: include });
    await AstraLibraryData.setSettings({ [INCLUDE_SINGLES_KEY]: include ? 'true' : 'false' });
  },

  setScopeMode: async (mode) => {
    if (get().scopeMode === mode) return;
    set({ scopeMode: mode });
    await AstraLibraryData.setSettings({ [SCOPE_MODE_KEY]: mode });
  },

  setScopeStageVisible: async (visible) => {
    if (get().scopeStageVisible === visible) return;
    set({ scopeStageVisible: visible });
    await AstraLibraryData.setSettings({ [SCOPE_STAGE_VISIBLE_KEY]: visible ? 'true' : 'false' });
  },

  setNowPlayingScopeStyle: async (style) => {
    if (get().nowPlayingScopeStyle === style) return;
    set({ nowPlayingScopeStyle: style });
    await AstraLibraryData.setSettings({ [SCOPE_STYLE_KEY]: style });
  },

  setLyricsVisible: async (visible) => {
    if (get().lyricsVisible === visible) return;
    set({ lyricsVisible: visible });
    await AstraLibraryData.setSettings({ [LYRICS_VISIBLE_KEY]: visible ? 'true' : 'false' });
  },

  setNowPlayingCompanion: async (companion) => {
    if (get().nowPlayingCompanion === companion) return;
    set({ nowPlayingCompanion: companion });
    await AstraLibraryData.setSettings({ [NOW_PLAYING_COMPANION_KEY]: companion });
  },

  setHomeGreetingTextMode: async (mode) => {
    const nextMode = parseHomeGreetingTextMode(mode);
    if (get().homeGreetingTextMode === nextMode) return;
    set({ homeGreetingTextMode: nextMode });
    await AstraLibraryData.setSettings({ [HOME_GREETING_TEXT_MODE_KEY]: nextMode });
  },
}));
