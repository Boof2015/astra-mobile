import {
  getAllTracks,
  getRecentlyPlayedTracks,
  getTracksByAlbumKey,
} from '@/db/queries';
import {
  getFavoriteTracks,
  getPlaylistEntries,
  getPlaylists,
  markPlaylistPlayed,
} from '@/db/playlistQueries';
import { openLibraryDb, type LibraryDatabase } from '@/db/database';
import { buildAlbumList } from '@/library/albumSummary';
import { buildArtistList, filterTracksByArtist } from '@/library/artistGrouping';
import { dbTrackToTrack } from '@/library/trackAdapter';
import { playForCar, playTracksForCar, pause, seekTo, skipToNext, skipToPrevious } from '@/audio/playbackController';
import { syncCarNowPlayingFromTrackPlayer } from '@/audio/carSync';
import { startAudioProcessingWarmup } from '@/audio/audioProcessingStartup';
import TrackPlayer, { type Track as RntpTrack } from 'react-native-track-player';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { useRemoteSourcesStore } from '@/stores/remoteSourcesStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { PlaybackSource } from '@/types/audio';
import type { DbTrack } from '@/types/library';

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
      await useSettingsStore.getState().load();
      await useLibraryStore.getState().initialize();
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
  const db = await openLibraryDb();
  const resolved = await resolveMediaTracks(db, media);
  if (!resolved || resolved.tracks.length === 0) return;
  await playTracksForCar(resolved.tracks.map(dbTrackToTrack), {
    startIndex: resolved.startIndex,
    source: resolved.source,
  });
  if (media.kind === 'playlist' && media.id != null) {
    await markPlaylistPlayed(db, media.id);
  }
}

async function resolveMediaTracks(
  db: LibraryDatabase,
  media: CarMediaPayload,
): Promise<{ tracks: DbTrack[]; startIndex: number; source: PlaybackSource } | null> {
  if (media.kind === 'track') {
    const context = contextFromTrack(media);
    const contextTracks = context ? await tracksForContext(db, context) : [];
    const startIndex = contextTracks.findIndex((track) => track.path === media.path);
    if (context && contextTracks.length > 0 && startIndex >= 0) {
      return {
        tracks: contextTracks,
        startIndex,
        source: await sourceForContext(db, context, contextTracks),
      };
    }
    const track = media.path ? await getTrackByPath(db, media.path) : null;
    return track
      ? {
          tracks: [track],
          startIndex: 0,
          source: { kind: 'android-auto', label: 'Android Auto' },
        }
      : null;
  }

  const tracks = await tracksForContext(db, media);
  return tracks.length > 0
    ? {
        tracks,
        startIndex: 0,
        source: await sourceForContext(db, media, tracks),
      }
    : null;
}

async function sourceForContext(
  db: LibraryDatabase,
  media: CarMediaPayload,
  tracks: readonly DbTrack[],
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
      : (await getPlaylists(db)).find((entry) => entry.id === media.id);
    return { kind: 'playlist', label: playlist?.name ?? 'Playlist' };
  }
  if (media.kind === 'album') {
    return { kind: 'album', label: tracks[0]?.album?.trim() || 'Album' };
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

async function tracksForContext(db: LibraryDatabase, media: CarMediaPayload): Promise<DbTrack[]> {
  switch (media.kind) {
    case 'section':
      if (media.section === 'recent') return getRecentlyPlayedTracks(db, 24);
      if (media.section === 'favorites') return getFavoriteTracks(db);
      return [];
    case 'playlist':
      if (media.id == null) return [];
      return (await getPlaylistEntries(db, media.id))
        .map((entry) => entry.track)
        .filter((track): track is DbTrack => Boolean(track));
    case 'album':
      return media.key ? getTracksByAlbumKey(db, media.key) : [];
    case 'artist': {
      if (!media.key) return [];
      const tracks = await getAllTracks(db);
      return filterTracksByArtist(
        tracks,
        media.key,
        useSettingsStore.getState().artistGroupingMode,
      );
    }
    default:
      return [];
  }
}

async function getTrackByPath(db: LibraryDatabase, path: string): Promise<DbTrack | null> {
  return (await db.get<DbTrack>('SELECT * FROM tracks WHERE path = ?', [path])) ?? null;
}

async function playSearch(payload: CarCommandPayload): Promise<void> {
  const db = await openLibraryDb();
  const playlistTerm = cleanSearchTerm(payload.playlist) || focusedTerm(payload, 'playlist');
  if (playlistTerm) {
    const playlist = bestMatch(await getPlaylists(db), playlistTerm, (entry) => [entry.name]);
    if (playlist) return playMedia({ kind: 'playlist', id: playlist.id });
  }

  const albumTerm = cleanSearchTerm(payload.album) || focusedTerm(payload, 'album');
  if (albumTerm) {
    // Voice search matches everything, including singles the browse grid hides.
    const albums = buildAlbumList(await getAllTracks(db), { includeSingles: true });
    const album = bestMatch(albums, albumTerm, (entry) => [entry.album, entry.artist]);
    if (album) return playMedia({ kind: 'album', key: album.identity_key });
  }

  const artistTerm = cleanSearchTerm(payload.artist) || focusedTerm(payload, 'artist');
  if (artistTerm) {
    const artistName = await bestArtistName(db, artistTerm);
    if (artistName) return playMedia({ kind: 'artist', key: artistName });
  }

  const titleTerm = cleanSearchTerm(payload.title);
  if (titleTerm) {
    const track = bestMatch(await getAllTracks(db), titleTerm, (entry) => [entry.title]);
    if (track) return playMedia({ kind: 'track', path: track.path });
  }

  const query = cleanSearchTerm(payload.query);
  if (!query) {
    await playForCar();
    return;
  }

  const candidate = await bestGeneralSearchCandidate(db, query, payload.focus);
  if (candidate) await playMedia(candidate);
}

async function bestGeneralSearchCandidate(
  db: LibraryDatabase,
  query: string,
  focus?: string,
): Promise<CarMediaPayload | null> {
  const [tracks, playlists] = await Promise.all([getAllTracks(db), getPlaylists(db)]);
  const albums = buildAlbumList(tracks, { includeSingles: true });
  const artistName = await bestArtistName(db, query);

  const candidates: { media: CarMediaPayload; score: number }[] = [];
  const focused = cleanSearchTerm(focus);

  const track = bestMatchWithScore(tracks, query, (entry) => [entry.title, entry.artist, entry.album]);
  if (track) candidates.push({ media: { kind: 'track', path: track.item.path }, score: track.score + categoryPenalty(focused, 'track') });

  const album = bestMatchWithScore(albums, query, (entry) => [entry.album, entry.artist]);
  if (album) candidates.push({ media: { kind: 'album', key: album.item.identity_key }, score: album.score + categoryPenalty(focused, 'album') });

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

async function bestArtistName(db: LibraryDatabase, query: string): Promise<string | null> {
  const tracks = await getAllTracks(db);
  const mode = useSettingsStore.getState().artistGroupingMode;
  const artists = useLibraryStore.getState().artists.length
    ? useLibraryStore.getState().artists
    : buildArtistNamesFromTracks(tracks, mode);
  return bestMatch(artists, query, (entry) => [entry.artist])?.artist ?? null;
}

function buildArtistNamesFromTracks(
  tracks: DbTrack[],
  mode: ReturnType<typeof useSettingsStore.getState>['artistGroupingMode'],
): { artist: string }[] {
  return buildArtistList(tracks, mode).map((artist) => ({ artist: artist.artist }));
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
