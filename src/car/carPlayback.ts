import {
  AstraLibraryData,
  type LibraryQuery,
} from '../../modules/astra-library-scanner';
import { dbTrackToTrack } from '@/library/trackAdapter';
import {
  pause,
  playForCar,
  playLibraryQuery,
  playTracksForCar,
  seekTo,
  skipToNext,
  skipToPrevious,
} from '@/audio/playbackController';
import { syncCarNowPlayingFromTrackPlayer } from '@/audio/carSync';
import { startAudioProcessingWarmup } from '@/audio/audioProcessingStartup';
import TrackPlayer, { type Track as RntpTrack } from 'react-native-track-player';
import { usePlaylistStore } from '@/stores/playlistStore';
import { useRemoteSourcesStore } from '@/stores/remoteSourcesStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { PlaybackSource } from '@/types/audio';
import type { DbTrack } from '@/types/library';
import type { Playlist } from '@/types/playlist';

export interface CarMediaPayload {
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
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export async function handleAstraCarCommand(payload: CarCommandPayload): Promise<void> {
  try {
    // Warm DSP independently of catalog/library startup. Transport commands do
    // not need to wait for a full library initialize; media-id/search commands do.
    void startAudioProcessingWarmup('car-command').catch(() => {});

    switch (payload.command) {
      case 'playMediaId':
        await initializeForCar();
        if (payload.media) await playMedia(payload.media);
        break;
      case 'playSearch':
        await initializeForCar();
        await playSearch(payload);
        break;
      case 'play':
        await playForCar();
        break;
      case 'pause':
        await pause();
        break;
      case 'next':
        await skipToNext();
        break;
      case 'previous':
        await skipToPrevious();
        break;
      case 'seek':
        if (typeof payload.position === 'number') await seekTo(payload.position);
        break;
      case 'toggleFavorite':
        await initializeForCar();
        await handleFavoriteCommand();
        break;
      default:
        break;
    }
  } catch (err) {
    console.warn('[car] command failed', err);
  } finally {
    await syncCarNowPlayingFromTrackPlayer();
  }
}

async function handleFavoriteCommand(): Promise<void> {
  const activeTrack = await TrackPlayer.getActiveTrack();
  const path = rntpTrackPath(activeTrack);
  if (!path) return;
  await usePlaylistStore.getState().toggleFavorite({ path });
}

function rntpTrackPath(track: RntpTrack | null | undefined): string | null {
  if (!track) return null;
  if (typeof track.astraPath === 'string' && track.astraPath.length > 0) return track.astraPath;
  return typeof track.url === 'string' && track.url.length > 0 ? track.url : null;
}

async function playMedia(media: CarMediaPayload): Promise<void> {
  const contextMedia = media.kind === 'track' ? contextFromTrack(media) : media;
  const query = contextMedia ? queryForMedia(contextMedia) : null;
  if (query) {
    await playLibraryQuery(query, {
      anchorPath: media.kind === 'track' ? media.path : null,
      source: await sourceForContext(contextMedia!),
      allowBackgroundSetup: true,
    });
  } else if (media.path) {
    const track = await AstraLibraryData.getTrack<DbTrack>(media.path);
    if (!track) return;
    await playTracksForCar([dbTrackToTrack(track)], {
      startIndex: 0,
      source: { kind: 'android-auto', label: 'Android Auto' },
    });
  } else {
    return;
  }
  if (media.kind === 'playlist' && media.id != null) {
    await AstraLibraryData.markPlaylistPlayed(media.id);
  }
}

function queryForMedia(media: CarMediaPayload): LibraryQuery | null {
  if (media.kind === 'section' && media.section === 'favorites') return { kind: 'favorites' };
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
  if (media.kind === 'section' && media.section === 'favorites') {
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
  const playlistTerm = cleanSearchTerm(payload.playlist) || focusedTerm(payload, 'playlist');
  if (playlistTerm) {
    const playlist = bestMatch(
      await AstraLibraryData.listPlaylists<Playlist>(),
      playlistTerm,
      (entry) => [entry.name],
    );
    if (playlist) return playMedia({ kind: 'playlist', id: playlist.id });
  }

  const albumTerm = cleanSearchTerm(payload.album) || focusedTerm(payload, 'album');
  if (albumTerm) {
    const albums = albumsFromTracks(await AstraLibraryData.searchTracks<DbTrack>(albumTerm, 100));
    const album = bestMatch(albums, albumTerm, (entry) => [entry.album, entry.artist]);
    if (album) return playMedia({ kind: 'album', key: album.key });
  }

  const artistTerm = cleanSearchTerm(payload.artist) || focusedTerm(payload, 'artist');
  if (artistTerm) {
    const artistName = bestArtistName(
      await AstraLibraryData.searchTracks<DbTrack>(artistTerm, 100),
      artistTerm,
    );
    if (artistName) return playMedia({ kind: 'artist', key: artistName });
  }

  const titleTerm = cleanSearchTerm(payload.title);
  if (titleTerm) {
    const track = bestMatch(
      await AstraLibraryData.searchTracks<DbTrack>(titleTerm, 100),
      titleTerm,
      (entry) => [entry.title],
    );
    if (track) return playMedia({ kind: 'track', path: track.path });
  }

  const query = cleanSearchTerm(payload.query);
  if (!query) {
    await playForCar();
    return;
  }

  const candidate = await bestGeneralSearchCandidate(query, payload.focus);
  if (candidate) await playMedia(candidate);
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

  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.media ?? null;
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

function focusedTerm(payload: CarCommandPayload, focus: string): string | null {
  return cleanSearchTerm(payload.focus) === focus ? cleanSearchTerm(payload.query) : null;
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
