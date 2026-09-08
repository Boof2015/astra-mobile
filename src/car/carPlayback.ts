import {
  AstraLibraryData,
  type LibraryQuery,
} from '../../modules/astra-library-scanner';
import { dbTrackToTrack } from '@/library/trackAdapter';
import {
  pause,
  cycleRepeat,
  setRepeatMode,
  setShuffleEnabled,
  jumpToCarQueueEntry,
  enqueueTop,
  enqueueEnd,
  enqueueLibraryQuery,
  playForCar,
  playLibraryQuery,
  playTracksForCar,
  seekTo,
  skipToNext,
  skipToPrevious,
} from '@/audio/playbackController';
import { initializeCarContextSync } from '@/audio/carSync';
import { setupPlayer } from '@/audio/trackPlayer';
import { restoreSavedPlayback } from '@/session/restorePlayback';
import { AstraCar } from '../../modules/astra-car';
import { createCarCommandCoordinator, carCommandError } from './carCommandQueue';
import { voiceIntent, constrainedTrackScore } from './carSearchPolicy';
import { startAudioProcessingWarmup } from '@/audio/audioProcessingStartup';
import TrackPlayer, { type Track as RntpTrack } from 'react-native-track-player';
import { usePlaylistStore } from '@/stores/playlistStore';
import { useRemoteSourcesStore } from '@/stores/remoteSourcesStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { PlaybackSource } from '@/types/audio';
import type { DbTrack } from '@/types/library';
import type { Playlist } from '@/types/playlist';

export interface CarMediaPayload {
  session?: string;
  kind?: string;
  section?: string;
  key?: string;
  id?: number;
  path?: string;
  contextKind?: string;
  contextSection?: string;
  contextKey?: string;
  contextId?: number;
}

export interface CarCommandPayload {
  requestId?: string;
  enabled?: boolean;
  repeat?: 'none' | 'all' | 'one';
  placement?: 'next' | 'end';
  command?: string;
  media?: CarMediaPayload;
  query?: string;
  focus?: string;
  title?: string;
  artist?: string;
  album?: string;
  playlist?: string;
  position?: number;
}

let initPromise: Promise<void> | null = null;

async function initializeForCar(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await AstraLibraryData.initialize();
      await useSettingsStore.getState().load();
      await usePlaylistStore.getState().refresh();
      await useRemoteSourcesStore.getState().init();
      await restoreSavedPlayback();
      initializeCarContextSync();
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export const handleAstraCarCommand = createCarCommandCoordinator<CarCommandPayload>({
  isActive: (id) => AstraCar.isCommandActive(id),
  complete: (id, error) => AstraCar.completeCommand(id, error),
  formatError: carCommandError,
  execute: async (payload) => {
    const id = payload.requestId;
    await initializeForCar();
    if (id && !await AstraCar.isCommandActive(id)) return;
    if (payload.command === 'initialize') return;
    if (payload.command === 'toggleFavorite') return handleFavoriteCommand();
    if (payload.command === 'pause' && usePlayerStore.getState().restoredSessionPending) return;
    void startAudioProcessingWarmup('car-command').catch(() => {});
    // All car actions may arrive without an Activity. This does not start audio.
    await setupPlayer({ allowBackgroundSetup: true });
    switch (payload.command) {
      case 'playMediaId':
        if (!payload.media) throw new Error('This item is unavailable.');
        await playMedia(payload.media); break;
      case 'playSearch': await playSearch(payload); break;
      case 'play': await playForCar(); break;
      case 'pause': await pause(); break;
      case 'next': await skipToNext(); break;
      case 'previous': await skipToPrevious(); break;
      case 'seek':
        if (typeof payload.position !== 'number' || !Number.isFinite(payload.position)) throw new Error('Invalid playback position.');
        await seekTo(Math.max(0, payload.position)); break;
      case 'setShuffle':
        if (typeof payload.enabled !== 'boolean') throw new Error('Invalid shuffle mode.');
        await setShuffleEnabled(payload.enabled); break;
      case 'setRepeat':
        if (!payload.repeat || !['none', 'all', 'one'].includes(payload.repeat)) throw new Error('Invalid repeat mode.');
        await setRepeatMode(payload.repeat); break;
      case 'cycleRepeat': await cycleRepeat(); break;
      case 'enqueue': await enqueueMedia(payload); break;
      default: throw new Error('This car control is unavailable.');
    }
  },
});

async function enqueueMedia(payload: CarCommandPayload): Promise<void> {
  const media = payload.media;
  if (!media || !['next', 'end'].includes(payload.placement ?? '')) throw new Error('This action is unavailable.');
  const placement = payload.placement!;
  if (media.kind === 'track' && media.path) {
    const track = await AstraLibraryData.getTrack<DbTrack>(media.path);
    if (!track) throw new Error('This track is no longer available.');
    await (placement === 'next' ? enqueueTop : enqueueEnd)(dbTrackToTrack(track));
  } else {
    const query = queryForMedia(media);
    if (!query) throw new Error('This collection is no longer available.');
    await enqueueLibraryQuery(query, placement);
  }
}

async function handleFavoriteCommand(): Promise<void> {
  const activeTrack = await TrackPlayer.getActiveTrack().catch(() => null);
  const path = rntpTrackPath(activeTrack) ?? usePlayerStore.getState().currentTrack?.path;
  if (!path) throw new Error('Choose a song before changing favorites.');
  await usePlaylistStore.getState().toggleFavorite({ path });
}

function rntpTrackPath(track: RntpTrack | null | undefined): string | null {
  if (!track) return null;
  if (typeof track.astraPath === 'string' && track.astraPath.length > 0) return track.astraPath;
  return typeof track.url === 'string' && track.url.length > 0 ? track.url : null;
}

async function playMedia(media: CarMediaPayload): Promise<void> {
  if (media.kind === 'queueEntry') {
    if (!media.session || !media.key) throw new Error('This queue item is no longer available.');
    return jumpToCarQueueEntry(media.session, media.key);
  }
  const contextMedia = media.kind === 'track' ? contextFromTrack(media) : media;
  const query = contextMedia ? queryForMedia(contextMedia) : null;
  if (query) {
    await playLibraryQuery(query, {
      anchorPath: media.kind === 'track' ? media.path : null,
      source: await sourceForContext(contextMedia!),
      allowBackgroundSetup: true,
      shuffle: (media.kind === 'shuffleAll' || (media.kind === 'section' && media.section === 'shuffleAll')),
    });
  } else if (media.path) {
    const track = await AstraLibraryData.getTrack<DbTrack>(media.path);
    if (!track) throw new Error('This track is no longer available.');
    await playTracksForCar([dbTrackToTrack(track)], {
      startIndex: 0,
      source: { kind: 'android-auto', label: 'Android Auto' },
    });
  } else {
    throw new Error('This item is no longer available.');
  }
  if (media.kind === 'playlist' && media.id != null) {
    await AstraLibraryData.markPlaylistPlayed(media.id);
  }
}

function queryForMedia(media: CarMediaPayload): LibraryQuery | null {
  if ((media.kind === 'shuffleAll' || (media.kind === 'section' && media.section === 'shuffleAll')) || (media.kind === 'section' && media.section === 'tracks')) return { kind: 'library', sort: 'title', direction: 'asc' };
  if (media.kind === 'section' && media.section === 'favorites') return { kind: 'favorites', sort: 'title' };
  if (media.kind === 'section' && media.section === 'recentFavorites') return { kind: 'favorites' };
  if (media.kind === 'section' && media.section === 'recent') return { kind: 'recent' };
  if (media.kind === 'playlist' && media.id != null) {
    return { kind: 'playlist', playlistId: media.id };
  }
  if (media.kind === 'album' && media.key) return { kind: 'album', albumKey: media.key };
  if (media.kind === 'artist' && media.key) {
    return {
      kind: 'artist',
      artistKey: media.key,
      groupingMode: useSettingsStore.getState().artistGroupingMode,
      section: 'all',
    };
  }
  return null;
}

async function sourceForContext(
  media: CarMediaPayload,
): Promise<PlaybackSource> {
  if (media.kind === 'section' && (media.section === 'favorites' || media.section === 'recentFavorites')) {
    return { kind: 'favorites', label: 'Favorites' };
  }
  if (media.kind === 'section' && media.section === 'recent') {
    return { kind: 'recently-played', label: 'Recently Played' };
  }
  if (media.kind === 'playlist') {
    const playlist = media.id == null
      ? null
      : (await AstraLibraryData.listPlaylists<Playlist>()).find((entry) => entry.id === media.id);
    return { kind: 'playlist', label: playlist?.name ?? 'Playlist' };
  }
  if (media.kind === 'album') {
    const detail = media.key
      ? await AstraLibraryData.getAlbumDetail<DbTrack, { album: string }>(media.key, null, 1)
      : null;
    return { kind: 'album', label: detail?.summary?.album?.trim() || 'Album' };
  }
  if (media.kind === 'artist') {
    return { kind: 'artist', label: media.key?.trim() || 'Artist' };
  }
  return { kind: 'android-auto', label: 'Android Auto' };
}

function contextFromTrack(media: CarMediaPayload): CarMediaPayload | null {
  if (!media.contextKind) return null;
  return {
    kind: media.contextKind,
    section: media.contextSection,
    key: media.contextKey,
    id: media.contextId,
  };
}

async function playSearch(payload: CarCommandPayload): Promise<void> {
  const intent = voiceIntent(payload);
  if (!intent.term) return playForCar();
  const { term, focus } = intent;
  if (focus === 'track') {
    const terms = [term, payload.artist, payload.album].filter(Boolean).join(' ');
    const tracks = await AstraLibraryData.searchTracks<DbTrack>(terms, 100);
    const ranked = tracks.map((track) => ({ track, score: constrainedTrackScore(track, term, payload.artist, payload.album) }))
      .filter((entry) => Number.isFinite(entry.score)).sort((a, b) => a.score - b.score);
    if (ranked[0]) return playMedia({ kind: 'track', path: ranked[0].track.path });
  } else {
    const candidate = await bestGeneralSearchCandidate(term, focus ?? undefined);
    if (candidate) return playMedia(candidate);
  }
  throw new Error('No matching music found. Try the song, album, artist, or playlist name.');
}

async function bestGeneralSearchCandidate(
  query: string,
  focus?: string,
): Promise<CarMediaPayload | null> {
  const [tracks, playlists] = await Promise.all([
    AstraLibraryData.searchTracks<DbTrack>(query, 100),
    AstraLibraryData.listPlaylists<Playlist>(),
  ]);
  const albums = albumsFromTracks(tracks);
  const artistName = bestArtistName(tracks, query);

  const candidates: { media: CarMediaPayload; score: number }[] = [];
  const focused = cleanSearchTerm(focus);

  const track = bestMatchWithScore(tracks, query, (entry) => [entry.title, entry.artist, entry.album]);
  if (track) candidates.push({ media: { kind: 'track', path: track.item.path }, score: track.score + categoryPenalty(focused, 'track') });

  const album = bestMatchWithScore(albums, query, (entry) => [entry.album, entry.artist]);
  if (album) candidates.push({ media: { kind: 'album', key: album.item.key }, score: album.score + categoryPenalty(focused, 'album') });

  const playlist = bestMatchWithScore(playlists, query, (entry) => [entry.name]);
  if (playlist) candidates.push({ media: { kind: 'playlist', id: playlist.item.id }, score: playlist.score + categoryPenalty(focused, 'playlist') });

  if (artistName) {
    const score = scoreValue(artistName, query);
    if (Number.isFinite(score)) {
      candidates.push({ media: { kind: 'artist', key: artistName }, score: score + categoryPenalty(focused, 'artist') });
    }
  }

  const matching = focused ? candidates.filter((candidate) => candidate.media.kind === focused) : candidates;
  matching.sort((a, b) => a.score - b.score);
  return matching[0]?.media ?? null;
}

function categoryPenalty(focus: string | null, category: string): number {
  if (!focus) {
    if (category === 'track') return 0;
    if (category === 'album') return 2;
    if (category === 'artist') return 3;
    return 4;
  }
  return focus === category ? -10 : 10;
}

function albumsFromTracks(
  tracks: readonly DbTrack[],
): { key: string; album: string; artist: string }[] {
  const albums = new Map<string, { key: string; album: string; artist: string }>();
  for (const track of tracks) {
    if (!albums.has(track.album_identity_key)) {
      albums.set(track.album_identity_key, {
        key: track.album_identity_key,
        album: track.album,
        artist: track.album_display_artist ?? track.album_artist ?? track.artist,
      });
    }
  }
  return [...albums.values()];
}

function bestArtistName(tracks: readonly DbTrack[], query: string): string | null {
  const names = new Map<string, { artist: string }>();
  for (const track of tracks) {
    for (const name of [track.album_artist, track.artist]) {
      const trimmed = name?.trim();
      if (trimmed) names.set(normalize(trimmed), { artist: trimmed });
    }
  }
  return bestMatch([...names.values()], query, (entry) => [entry.artist])?.artist ?? null;
}

function cleanSearchTerm(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized ? normalized : null;
}

function bestMatch<T>(
  items: readonly T[],
  query: string,
  labels: (item: T) => readonly (string | null | undefined)[],
): T | null {
  return bestMatchWithScore(items, query, labels)?.item ?? null;
}

function bestMatchWithScore<T>(
  items: readonly T[],
  query: string,
  labels: (item: T) => readonly (string | null | undefined)[],
): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    const score = Math.min(...labels(item).map((label) => scoreValue(label, query)));
    if (!Number.isFinite(score)) continue;
    if (!best || score < best.score) best = { item, score };
  }
  return best;
}

function scoreValue(value: string | null | undefined, query: string): number {
  const candidate = normalize(value);
  const needle = normalize(query);
  if (!candidate || !needle) return Number.POSITIVE_INFINITY;
  if (candidate === needle) return 0;
  if (candidate.startsWith(needle)) return 10;
  if (candidate.includes(needle)) return 20;
  return Number.POSITIVE_INFINITY;
}

function normalize(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim().toLocaleLowerCase() ?? '';
}
