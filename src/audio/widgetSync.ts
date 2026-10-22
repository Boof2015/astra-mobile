import TrackPlayer, { State, type Track as RntpTrack } from 'react-native-track-player';

import type { PlaybackState, Track } from '@/types/audio';
import type { DbTrack } from '@/types/library';
import { artworkThumbFromSource, artworkUri as fullArtworkUri } from '@/library/artwork';
import type { AccentPreference } from '@/theme/accents';
import type { Palette } from '@/theme/palettes';
import { resolveTheme, type BaseThemeId, type PreferredDark } from '@/theme/resolve';
import {
  AstraWidget,
  type AstraWidgetAppTheme,
  type AstraWidgetRecentItem,
  type AstraWidgetThemeTokens,
} from '../../modules/astra-widget';

function mapRntpState(state?: State): PlaybackState {
  switch (state) {
    case State.Playing:
      return 'playing';
    case State.Buffering:
    case State.Loading:
      return 'loading';
    case State.Paused:
    case State.Ready:
      return 'paused';
    default:
      return 'stopped';
  }
}

// Last payload actually handed to the native module. Every real change rebuilds
// RemoteViews and ships them to the launcher (natively on a background thread,
// coalesced), and seek/skip fire several state events carrying identical
// resolved payloads — dedupe here so both callers (UI hook + headless service)
// collapse to real changes only.
let lastPushed: {
  title: string | null;
  artist: string | null;
  artworkUri: string | null;
  artworkFullUri: string | null;
  playbackState: PlaybackState;
  hasTrack: boolean;
  recents: AstraWidgetRecentItem[] | null;
} | null = null;

function sameRecents(a: AstraWidgetRecentItem[], b: AstraWidgetRecentItem[] | null): boolean {
  if (!b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].title !== b[i].title ||
      a[i].artist !== b[i].artist ||
      a[i].artworkUri !== b[i].artworkUri
    ) {
      return false;
    }
  }
  return true;
}

export function setWidgetNowPlaying(
  track: Pick<Track, 'title' | 'artist' | 'artworkData'> | null,
  playbackState: PlaybackState,
  recentlyPlayed?: AstraWidgetRecentItem[],
): void {
  const title = track?.title ?? null;
  const artist = track?.artist ?? null;
  // The widget clusters the thumbnail for its cover colors, exactly as the app
  // does, and decodes the full cover (natively, once per track, sampled down)
  // only for the art tile, which outgrows the thumbnail on larger sizes.
  // Inline data: covers have no thumbnail, so they arrive as `artworkUri` alone.
  const artworkUri = artworkThumbFromSource(track?.artworkData) ?? null;
  const artworkFullUri = track?.artworkData?.startsWith('file://') ? track.artworkData : null;
  const hasTrack = Boolean(track);

  const coreSame =
    lastPushed != null &&
    lastPushed.title === title &&
    lastPushed.artist === artist &&
    lastPushed.artworkUri === artworkUri &&
    lastPushed.artworkFullUri === artworkFullUri &&
    lastPushed.playbackState === playbackState &&
    lastPushed.hasTrack === hasTrack;
  // `recentlyPlayed === undefined` means "leave the recents as they are".
  const recentsSame =
    recentlyPlayed === undefined || (lastPushed != null && sameRecents(recentlyPlayed, lastPushed.recents));
  if (coreSame && recentsSame) return;

  AstraWidget.setNowPlaying({
    title,
    artist,
    artworkUri,
    artworkFullUri,
    playbackState,
    hasTrack,
    ...(recentlyPlayed === undefined
      ? {}
      : {
          recentlyPlayed,
          replaceRecentlyPlayed: true,
        }),
  });
  lastPushed = {
    title,
    artist,
    artworkUri,
    artworkFullUri,
    playbackState,
    hasTrack,
    recents: recentlyPlayed === undefined ? (lastPushed?.recents ?? null) : recentlyPlayed,
  };
}

export function setWidgetNowPlayingFromRntpTrack(
  track: RntpTrack | null | undefined,
  playbackState: PlaybackState,
): void {
  setWidgetNowPlaying(
    track
      ? {
          title: track.title ?? 'Unknown title',
          artist: track.artist ?? 'Unknown artist',
          artworkData: typeof track.artwork === 'string' ? track.artwork : undefined,
        }
      : null,
    playbackState,
  );
}

export function buildWidgetRecentItems(
  tracks: readonly DbTrack[],
  currentPath?: string,
): AstraWidgetRecentItem[] {
  return tracks
    .filter((track) => track.path !== currentPath)
    .slice(0, 8)
    .map((track) => ({
      title: track.title,
      artist: track.artist,
      // Full covers, decoded natively at tile size: the thumbnail is softer
      // than a large widget's recents tiles.
      artworkUri: track.artwork_hash ? fullArtworkUri(track.artwork_hash) : null,
    }));
}

function widgetTokens(colors: Palette): AstraWidgetThemeTokens {
  return {
    bgPrimary: colors.bgPrimary,
    bgSecondary: colors.bgSecondary,
    bgTertiary: colors.bgTertiary,
    textPrimary: colors.textPrimary,
    accent: colors.accent,
    accentText: colors.accentText,
  };
}

let lastTheme: string | null = null;

/**
 * Hands the widget's "Astra" style the app theme. The widget has its own
 * Light/Dark/System choice, so it gets both versions: the user's dark theme
 * (their preferred dark when the app is on Light or System) and Light, each with
 * their accent. On Material You the widget uses the system's own live colors.
 */
export function syncWidgetAppTheme(input: {
  baseTheme: BaseThemeId;
  preferredDark: PreferredDark;
  accentPreference: AccentPreference;
  materialYouAvailable: boolean;
}): void {
  const { baseTheme, preferredDark, accentPreference } = input;
  const darkBase =
    baseTheme === 'midnight' || baseTheme === 'dark' || baseTheme === 'amoled' ? baseTheme : preferredDark;
  const resolve = (base: BaseThemeId, systemScheme: 'light' | 'dark') =>
    resolveTheme({ baseTheme: base, preferredDark, accentPreference, systemScheme, materialYouRamps: null }).colors;
  const theme: AstraWidgetAppTheme = {
    dark: widgetTokens(resolve(darkBase, 'dark')),
    light: widgetTokens(resolve('light', 'light')),
    materialYou: baseTheme === 'materialYou' && input.materialYouAvailable,
  };
  const key = JSON.stringify(theme);
  if (key === lastTheme) return;
  lastTheme = key;
  AstraWidget.setAppTheme(theme);
}

export async function syncWidgetNowPlayingFromTrackPlayer(): Promise<void> {
  try {
    const [activeTrack, playbackState] = await Promise.all([
      TrackPlayer.getActiveTrack(),
      TrackPlayer.getPlaybackState(),
    ]);
    setWidgetNowPlayingFromRntpTrack(activeTrack, mapRntpState(playbackState.state));
  } catch {
    setWidgetNowPlaying(null, 'stopped');
  }
}
