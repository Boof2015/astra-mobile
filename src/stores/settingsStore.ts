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
import {
  pauseListeningHistoryTracking,
  resumeListeningHistoryTracking,
} from '@/audio/listeningHistoryTracker';
import { notifyListeningHistoryChanged } from '@/listeningStats/events';
import type { ArtistImageAutoPolicy } from '@/types/artistImages';

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
const LISTENING_HISTORY_ENABLED_KEY = 'listening_history_enabled';
const ARTIST_IMAGE_AUTO_POLICY_KEY = 'artist_image_auto_policy';
const ARTIST_IMAGE_DISCLOSURE_KEY = 'artist_image_disclosure_seen';
const PLAYER_DOCK_KEY = 'player_dock_open';

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

function parseArtistImageAutoPolicy(value: string | null): ArtistImageAutoPolicy {
  return value === 'off' || value === 'any' ? value : 'wifi';
}

interface SettingsStore {
  artistGroupingMode: ArtistGroupingMode;
  /** Show 1-track albums in the Albums view (desktop parity default: hidden). */
  includeSingles: boolean;
  scopeMode: ScopeMode;
  scopeStageVisible: boolean;
  /**
   * Whether the user wants the side-by-side player pane. Only honoured on a
   * window wide enough to seat one without squeezing the shell — the shell
   * arbitrates via `dockAllowed`, so this is a wish, not a fact.
   */
  playerDockOpen: boolean;
  nowPlayingScopeStyle: NowPlayingScopeStyle;
  /** Whether the now-playing top half shows lyrics instead of art/scope. */
  lyricsVisible: boolean;
  nowPlayingCompanion: NowPlayingCompanion;
  homeGreetingTextMode: HomeGreetingTextMode;
  listeningHistoryEnabled: boolean;
  artistImageAutoPolicy: ArtistImageAutoPolicy;
  artistImageDisclosureSeen: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  setArtistGroupingMode: (mode: ArtistGroupingMode) => Promise<void>;
  setIncludeSingles: (include: boolean) => Promise<void>;
  setScopeMode: (mode: ScopeMode) => Promise<void>;
  setScopeStageVisible: (visible: boolean) => Promise<void>;
  setPlayerDockOpen: (open: boolean) => Promise<void>;
  setNowPlayingScopeStyle: (style: NowPlayingScopeStyle) => Promise<void>;
  setLyricsVisible: (visible: boolean) => Promise<void>;
  setNowPlayingCompanion: (companion: NowPlayingCompanion) => Promise<void>;
  setHomeGreetingTextMode: (mode: HomeGreetingTextMode) => Promise<void>;
  setListeningHistoryEnabled: (enabled: boolean) => Promise<void>;
  setArtistImageAutoPolicy: (policy: ArtistImageAutoPolicy) => Promise<void>;
  acknowledgeArtistImageDisclosure: () => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  artistGroupingMode: 'astra',
  includeSingles: false,
  scopeMode: 'spectrum',
  scopeStageVisible: false,
  playerDockOpen: false,
  nowPlayingScopeStyle: 'rail',
  lyricsVisible: false,
  nowPlayingCompanion: 'queue',
  homeGreetingTextMode: 'messages',
  listeningHistoryEnabled: true,
  artistImageAutoPolicy: 'wifi',
  artistImageDisclosureSeen: false,
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
      LISTENING_HISTORY_ENABLED_KEY,
      ARTIST_IMAGE_AUTO_POLICY_KEY,
      ARTIST_IMAGE_DISCLOSURE_KEY,
      PLAYER_DOCK_KEY,
    ]);
    const grouping = values[ARTIST_GROUPING_KEY] ?? null;
    const includeSingles = values[INCLUDE_SINGLES_KEY] ?? null;
    const scope = values[SCOPE_MODE_KEY] ?? null;
    const scopeStageVisible = values[SCOPE_STAGE_VISIBLE_KEY] ?? null;
    const scopeStyle = values[SCOPE_STYLE_KEY] ?? null;
    const lyricsVisible = values[LYRICS_VISIBLE_KEY] ?? null;
    const nowPlayingCompanion = values[NOW_PLAYING_COMPANION_KEY] ?? null;
    const homeGreetingTextMode = values[HOME_GREETING_TEXT_MODE_KEY] ?? null;
    const listeningHistoryEnabled = values[LISTENING_HISTORY_ENABLED_KEY] !== '0';
    const artistImageAutoPolicy = parseArtistImageAutoPolicy(
      values[ARTIST_IMAGE_AUTO_POLICY_KEY] ?? null
    );
    const artistImageDisclosureSeen = values[ARTIST_IMAGE_DISCLOSURE_KEY] === '1';
    const playerDockOpen = values[PLAYER_DOCK_KEY] ?? null;
    set({
      artistGroupingMode: parseGroupingMode(grouping),
      includeSingles: parseBoolean(includeSingles),
      scopeMode: parseScopeMode(scope),
      scopeStageVisible: parseBoolean(scopeStageVisible),
      playerDockOpen: parseBoolean(playerDockOpen),
      nowPlayingScopeStyle: parseScopeStyle(scopeStyle),
      lyricsVisible: parseBoolean(lyricsVisible),
      nowPlayingCompanion: parseNowPlayingCompanion(nowPlayingCompanion),
      homeGreetingTextMode: parseHomeGreetingTextMode(homeGreetingTextMode),
      listeningHistoryEnabled,
      artistImageAutoPolicy,
      artistImageDisclosureSeen,
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

  setPlayerDockOpen: async (open) => {
    if (get().playerDockOpen === open) return;
    set({ playerDockOpen: open });
    await AstraLibraryData.setSettings({ [PLAYER_DOCK_KEY]: open ? 'true' : 'false' });
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

  setListeningHistoryEnabled: async (enabled) => {
    if (get().listeningHistoryEnabled === enabled) return;
    if (!enabled) await pauseListeningHistoryTracking();
    try {
      await AstraLibraryData.setSettings({
        [LISTENING_HISTORY_ENABLED_KEY]: enabled ? '1' : '0',
      });
      set({ listeningHistoryEnabled: enabled });
      notifyListeningHistoryChanged();
      if (enabled) resumeListeningHistoryTracking();
    } catch (error) {
      if (!enabled) resumeListeningHistoryTracking();
      throw error;
    }
  },

  setArtistImageAutoPolicy: async (policy) => {
    const previous = get().artistImageAutoPolicy;
    if (previous === policy) return;
    set({ artistImageAutoPolicy: policy });
    try {
      await AstraLibraryData.setSettings({ [ARTIST_IMAGE_AUTO_POLICY_KEY]: policy });
    } catch (error) {
      set({ artistImageAutoPolicy: previous });
      throw error;
    }
  },

  acknowledgeArtistImageDisclosure: async () => {
    if (get().artistImageDisclosureSeen) return;
    await AstraLibraryData.setSettings({ [ARTIST_IMAGE_DISCLOSURE_KEY]: '1' });
    set({ artistImageDisclosureSeen: true });
  },
}));
