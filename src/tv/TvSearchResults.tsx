import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import { playLibraryQuery } from '@/audio/playbackController';
import { findFuzzyMatch } from '@/lib/fuzzySearch';
import { albumArtworkSource, artworkThumbFromSource, artworkUri, trackArtworkThumbSource } from '@/library/artwork';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerStore } from '@/stores/playerStore';
import type { Album, Artist, DbTrack } from '@/types/library';
import { AlbumCard, TvTrackRow } from './TvBrowse';
import { TvCard, TvArtistArt, TvPlaylistArt } from './TvCards';
import { TvButton, useTvActive, useTvFocus } from './TvFocus';
import { box, tv, TvText, TvMotion, TvViewport } from './TvPrimitives';
import { useTvPage } from './useTvPage';
import { anchoredStart, restoredIndex, shelfOffset } from './focusGeometry';
import { searchCursor } from './searchModel';
import { playlistName, playlistKey, type TvActions, type TvPlaylist } from './tvCollections';

export type SearchRequest = { id: number; query: string; includeSingles: boolean; grouping: 'astra' | 'fileTags'; collaborations: boolean };
type Item = { kind: 'artist'; value: Artist } | { kind: 'album'; value: Album } | { kind: 'playlist'; value: TvPlaylist } | { kind: 'track'; value: DbTrack };
const artistKey = (artist: Artist) => artist.artist;
const albumKey = (album: Album) => album.identity_key;
const trackKey = (track: DbTrack) => track.path;
const itemKey = (item: Item) => item.kind === 'artist' ? artistKey(item.value) : item.kind === 'album' ? albumKey(item.value) : item.kind === 'playlist' ? playlistKey(item.value) : trackKey(item.value);
const idOf = (item: Item, options = false) => `search:result:${item.kind}:${itemKey(item)}:${options ? 1 : 0}`;

function useSearchPage<T>(search: SearchRequest, kind: 'artists' | 'albums' | 'tracks', key: (item: T) => string) {
  const read = useCallback(async (cursor: string | null) => {
    const { offset, revision } = searchCursor(cursor);
    const page = await AstraLibraryData.getTvSearchPage<T>(kind, search.query, offset, 120, revision, search.includeSingles, search.grouping, search.collaborations);
    return { ...page, nextCursor: page.nextOffset == null ? null : `${page.revision}:${page.nextOffset}` };
  }, [search, kind]);
  return useTvPage(read, key);
}

export function TvSearchResults({ search, actions, ready }: { search: SearchRequest; actions: TvActions; ready: (entry: string) => void }) {
  const active = useTvActive(); const { request } = useTvFocus();
  const artists = useSearchPage<Artist>(search, 'artists', artistKey);
  const albums = useSearchPage<Album>(search, 'albums', albumKey);
  const tracks = useSearchPage<DbTrack>(search, 'tracks', trackKey);
  const playlists = usePlaylistStore(s => s.playlists);
  const currentPath = usePlayerStore(s => s.currentTrack?.path);
  const [bandName, setBandName] = useState('Artists');
  const [memory, setMemory] = useState<Record<string, { key: string; index: number; options: boolean }>>({});
  const playlistResults = (['favorites', ...playlists] as TvPlaylist[]).flatMap(value => {
    const match = findFuzzyMatch(search.query, playlistName(value));
    return match ? [{ value, score: match.score }] : [];
  }).sort((a, b) => b.score - a.score).map(item => item.value);
  const bands: { title: string; items: Item[]; total: number; loadMore?: () => void }[] = [
    { title: 'Artists', items: artists.items.map(value => ({ kind: 'artist', value } as const)), total: artists.totalCount, loadMore: artists.loadMore },
    { title: 'Albums', items: albums.items.map(value => ({ kind: 'album', value } as const)), total: albums.totalCount, loadMore: albums.loadMore },
    { title: 'Playlists', items: playlistResults.map(value => ({ kind: 'playlist', value } as const)), total: playlistResults.length },
    { title: 'Tracks', items: tracks.items.map(value => ({ kind: 'track', value } as const)), total: tracks.totalCount, loadMore: tracks.loadMore },
  ].filter(band => band.items.length);
  const bandIndex = Math.max(0, bands.findIndex(band => band.title === bandName));
  const indexFor = (r: number) => restoredIndex(bands[r].items.map(itemKey), memory[bands[r].title]?.key, memory[bands[r].title]?.index ?? 0);
  const entryFor = (r: number, options = false) => idOf(bands[r].items[indexFor(r)], options);
  const error = artists.error || albums.error || tracks.error;
  const initializing = !bands.length && (artists.loading || albums.loading || tracks.loading);
  const allReady = !artists.loading && !albums.loading && !tracks.loading;
  const selected = bands[bandIndex]?.items[indexFor(bandIndex)];
  const entry = error ? 'search:retry' : selected ? idOf(selected, selected.kind === 'track' && memory.Tracks?.options) : 'search:field';
  useEffect(() => { if (active && allReady) ready(entry); }, [active, allReady, entry, ready]);
  useEffect(() => { if (active && error) request('search:retry'); }, [active, error, request]);
  const loadMore = bands[bandIndex]?.loadMore;
  const itemCount = bands[bandIndex]?.items.length ?? 0;
  const selectedIndex = bands.length ? indexFor(bandIndex) : 0;
  useEffect(() => { if (active && selectedIndex >= itemCount - 18) loadMore?.(); }, [active, selectedIndex, itemCount, loadMore]);
  const uri = selected?.kind === 'album' ? artworkThumbFromSource(albumArtworkSource(selected.value))
    : selected?.kind === 'artist' ? selected.value.artwork_hash && artworkUri(selected.value.artwork_hash)
    : selected?.kind === 'track' ? trackArtworkThumbSource(selected.value) : null;
  const { light } = actions;
  useEffect(() => { if (active) light(uri || null); }, [active, uri, light]);
  const retry = () => { if (artists.error) artists.retry(); if (albums.error) albums.retry(); if (tracks.error) tracks.retry(); };
  if (error || initializing || !bands.length) return <View style={box(51, 152, 858)}>
    <TvText size={16} weight="semibold">{error ? 'Could not load search results' : initializing ? 'Searching…' : `Nothing for “${search.query}”`}</TvText>
    <TvText color={tv.muted} style={{ marginTop: 6 }}>{error ? 'Try the search again.' : initializing ? 'Looking in your collection.' : 'Check the spelling, or try part of an artist, album or track name.'}</TvText>
    {error && <TvButton id="search:retry" label="Try search again" onPress={retry} links={{ up: 'search:field' }} style={{ width: 200, height: 38, backgroundColor: tv.fill, paddingHorizontal: 14, marginTop: 20 }}><TvText>Try again</TvText></TvButton>}
  </View>;
  return <TvViewport width={960} height={394} topFade={0} bottomFade={46} style={box(0, 146, 960, 394)}>
    {bands.map((band, r) => {
      const trackBand = band.title === 'Tracks';
      const index = indexFor(r); const start = trackBand ? anchoredStart(index, band.items.length, 6, 2) : 0;
      const offset = trackBand ? 0 : shelfOffset(index, band.items.length);
      const enter = (item: Item, i: number, options = false) => { setBandName(band.title); setMemory(previous => ({ ...previous, [band.title]: { key: itemKey(item), index: i, options } })); };
      const above = r ? entryFor(r - 1) : 'search:field';
      const below = r < bands.length - 1 ? entryFor(r + 1) : undefined;
      return <TvMotion key={band.title} y={-bandIndex * 213} style={[box(0, r * 213, 960, trackBand ? 394 : 206), { opacity: r < bandIndex ? 0 : 1 }]}>
        <TvText size={15} weight="semibold" color={r === bandIndex ? tv.strong : tv.muted} style={box(51, 0, 800)}>{band.title} <TvText mono size={11} color={tv.faint}>{band.total}</TvText></TvText>
        <TvViewport width={960} height={trackBand ? 370 : 184} topFade={0} bottomFade={0} shelf={!trackBand} style={box(0, trackBand ? 24 : 22, 960, trackBand ? 370 : 184)}>
          <TvMotion x={-offset} y={-start * 52} style={{ width: trackBand ? 960 : 102 + band.items.length * 146.2, height: trackBand ? band.items.length * 52 + 16 : 184 }}>
            {band.items.map((item, i) => {
              if (trackBand ? i < start - 2 || i > start + 9 : 51 + i * 146.2 - offset < -180 || 51 + i * 146.2 - offset > 1100) return null;
              const links = { left: trackBand ? undefined : idOf(band.items[Math.max(0, i - 1)]), right: trackBand ? undefined : idOf(band.items[Math.min(band.items.length - 1, i + 1)]),
                up: trackBand && i ? idOf(band.items[i - 1]) : above, down: trackBand ? idOf(band.items[Math.min(band.items.length - 1, i + 1)]) : below };
              const open = () => { if (item.kind !== 'track') actions.open(item.kind === 'artist' ? { kind: 'artist', artist: item.value } : item.kind === 'album' ? { kind: 'album', album: item.value } : { kind: 'playlist', playlist: item.value }); };
              if (item.kind === 'track') return <TvTrackRow key={itemKey(item)} track={item.value} id={idOf(item)} optionsId={idOf(item, true)} left={39} top={8 + i * 52} width={870} playing={item.value.path === currentPath}
                links={links} optionLinks={{ up: i ? idOf(band.items[i - 1], true) : above, down: idOf(band.items[Math.min(band.items.length - 1, i + 1)], true) }}
                enter={options => enter(item, i, options)} play={() => actions.run(() => playLibraryQuery({ kind: 'search', query: search.query, literalFallback: true }, { anchorPath: item.value.path, source: { kind: 'search', label: `Search: ${search.query}` } }))}
                options={() => actions.trackMenu(item.value, idOf(item, true), 178 + (i - start) * 52)} />;
              if (item.kind === 'album') return <AlbumCard key={itemKey(item)} album={item.value} id={idOf(item)} left={51 + i * 146.2} top={8} links={links} enter={() => enter(item, i)} open={open} />;
              return <TvCard key={itemKey(item)} id={idOf(item)} left={51 + i * 146.2} top={8} links={links} enter={() => enter(item, i)} open={open}
                title={item.kind === 'artist' ? item.value.artist : playlistName(item.value)} subtitle={item.kind === 'artist' ? `${item.value.album_count} releases · ${item.value.track_count} tracks` : item.value === 'favorites' ? 'Your liked tracks' : `${item.value.track_count} tracks`}
                art={item.kind === 'artist' ? <TvArtistArt artist={item.value} size={127} /> : <TvPlaylistArt playlist={item.value} size={127} />} />;
            })}
          </TvMotion>
        </TvViewport>
      </TvMotion>;
    })}
  </TvViewport>;
}
