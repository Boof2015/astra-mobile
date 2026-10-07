import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, withTiming } from 'react-native-reanimated';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import { albumArtworkSource, artworkThumbFromSource, trackArtworkThumbSource } from '@/library/artwork';
import { useLibraryStore } from '@/stores/libraryStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { usePlayerStore } from '@/stores/playerStore';
import type { Album, DbTrack } from '@/types/library';
import { formatDuration } from '@/lib/format';
import { gridNeighbor, restoredIndex, anchoredStart, shelfOffset } from './focusGeometry';
import { TvButton, useTvFocus } from './TvFocus';
import { box, tv, TvArtwork, TvText, TvMotion, TvViewport } from './TvPrimitives';
import { type TvMenu } from './TvPanel';
import { useTvPage } from './useTvPage';

export type BrowseActions = {
  openAlbum: (album: Album) => void;
  light: (uri: string | null) => void;
  menu: (value: TvMenu) => void;
  trackMenu: (track: DbTrack, opener: string, top: number) => void;
  playTrack: (track: DbTrack, sort: TrackSort) => void;
};
export type TrackSort = 'title' | 'artist' | 'recently_added';
type AlbumSort = 'artist' | 'name' | 'recently_added';
const albumKey = (album: Album) => album.identity_key;
const trackKey = (track: DbTrack) => track.path;
const gridId = (album: Album) => `album:${album.identity_key}`;
const trackId = (track: DbTrack, col = 0) => `track:${track.path}:${col}`;

export function albumFromTrack(track: DbTrack): Album {
  return { identity_key: track.album_identity_key, album: track.album, artist: track.album_display_artist ?? track.album_artist ?? track.artist,
    artwork_hash: track.artwork_hash, source_type: track.source_type, source_id: track.source_id, artwork_source_id: track.artwork_source_id,
    track_count: track.track_total ?? 0, latest_added_at: track.added_at, year: track.year };
}

function AlbumCard({ album, id, left, top, links, enter, open }: {
  album: Album; id: string; left: number; top: number; links: Parameters<typeof TvButton>[0]['links']; enter: () => void; open: () => void;
}) {
  const { focused } = useTvFocus();
  const active = focused === id;
  const reduced = useReducedMotion();
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: withTiming(active && !reduced ? 1.03 : 1, { duration: reduced ? 0 : 140 }) }] }));
  return <View style={box(left, top, 127, 174)}>
    <Animated.View style={animated}><TvButton id={id} label={`${album.album}, ${album.artist}`} links={links} onFocus={enter} onPress={open}
      style={{ width: 127, height: 127, borderRadius: 6 }} ringStyle={{ top: -5, bottom: -5, left: -5, right: -5, borderRadius: 10 }}>
      <TvArtwork uri={albumArtworkSource(album)} size={127} />
    </TvButton></Animated.View>
    <TvText weight="medium" color={active ? tv.strong : tv.caption} numberOfLines={1} style={{ marginTop: 9 }}>{album.album}</TvText>
    <TvText size={11} color={tv.muted} numberOfLines={1} style={{ marginTop: 2 }}>{album.artist}</TvText>
  </View>;
}

export function TvHome({ actions, setEntry }: { actions: BrowseActions; setEntry: (key: string) => void }) {
  const added = useLibraryStore(s => s.homeAlbums);
  const recentTracks = useLibraryStore(s => s.recentlyPlayedTracks);
  const recent = [...new Map(recentTracks.map(track => [track.album_identity_key, albumFromTrack(track)])).values()];
  const rows = [{ title: 'Recently played', items: recent }, { title: 'Recently added', items: added }].filter(row => row.items.length);
  const [activeRow, setActiveRow] = useState('Recently played');
  const [memory, setMemory] = useState<Record<string, { key: string; index: number }>>({});
  const rowIndex = Math.max(0, rows.findIndex(row => row.title === activeRow));
  const indexFor = (r: number) => restoredIndex(rows[r].items.map(albumKey), memory[rows[r].title]?.key, memory[rows[r].title]?.index ?? 0);
  const idFor = (r: number, i: number) => `home:${rows[r].title}:${rows[r].items[i].identity_key}`;
  const row = rows[rowIndex];
  const item = row?.items[indexFor(rowIndex)];
  const entry = row ? idFor(rowIndex, indexFor(rowIndex)) : 'nav:library';
  useEffect(() => setEntry(entry), [entry, setEntry]);
  return <>
    <TvText mono size={10.5} color={tv.accent} style={[box(51, 88, 600), { letterSpacing: 1.6 }]}>{item ? 'FROM YOUR COLLECTION' : 'YOUR MUSIC, ON TV'}</TvText>
    <TvText size={34} weight="semibold" numberOfLines={1} style={[box(51, 102, 740), { lineHeight: 40 }]}>{item?.album ?? 'Welcome to Astra'}</TvText>
    <TvText size={14} color={tv.muted} style={box(51, 148, 740)}>{item?.artist ?? 'Open Library to browse your collection.'}</TvText>
    {!!item?.track_count && <TvText mono size={11.5} color={tv.muted} style={box(51, 174, 740)}>{item.track_count} tracks{item.year ? ` · ${item.year}` : ''}</TvText>}
    <TvViewport width={960} height={540} topFade={0} bottomFade={52} style={box(0, 0, 960, 540)}>
    {rows.map((row, r) => <TvMotion key={row.title} y={-rowIndex * 213} style={[box(0, 206 + r * 213, 960, 206), { opacity: r < rowIndex ? 0 : 1 }]}>
      <TvText size={15} weight="semibold" color={r === rowIndex ? tv.strong : tv.muted} style={box(51, 0, 800)}>{row.title}</TvText>
      <TvViewport width={960} height={184} shelf style={box(0, 22, 960, 184)}>
        <TvMotion x={-shelfOffset(indexFor(r), row.items.length)} style={{ width: 102 + row.items.length * 146.2, height: 184 }}>
        {row.items.map((album, i) => {
          const left = 51 + i * 146.2 - shelfOffset(indexFor(r), row.items.length);
          if (left < -180 || left > 1100) return null;
          return <AlbumCard key={album.identity_key} album={album} id={idFor(r, i)} left={51 + i * 146.2} top={8}
            links={{ left: idFor(r, Math.max(0, i - 1)), right: idFor(r, Math.min(row.items.length - 1, i + 1)),
              up: r === 0 ? 'nav:home' : idFor(r - 1, indexFor(r - 1)), down: r < rows.length - 1 ? idFor(r + 1, indexFor(r + 1)) : undefined }}
            enter={() => { setActiveRow(row.title); setMemory(prev => ({ ...prev, [row.title]: { key: album.identity_key, index: i } })); actions.light(artworkThumbFromSource(albumArtworkSource(album))); }}
            open={() => actions.openAlbum(album)} />;
        })}
        </TvMotion>
      </TvViewport>
    </TvMotion>)}
    </TvViewport>
  </>;
}

export function TvLibrary({ actions, setEntry }: { actions: BrowseActions; setEntry: (key: string) => void }) {
  const { request, focused } = useTvFocus();
  const [section, setSection] = useState<'albums' | 'tracks'>('albums');
  const [albumSort, setAlbumSort] = useState<AlbumSort>('artist');
  const [trackSort, setTrackSort] = useState<TrackSort>('title');
  const [memory, setMemory] = useState({ albums: { key: '', index: 0 }, tracks: { key: '', index: 0 } });
  const includeSingles = useSettingsStore(s => s.includeSingles);
  const readAlbums = useCallback((cursor: string | null) => AstraLibraryData.getAlbumPage<Album>(albumSort, albumSort === 'recently_added' ? 'desc' : 'asc', includeSingles, cursor, 120), [albumSort, includeSingles]);
  const readTracks = useCallback((cursor: string | null) => AstraLibraryData.getTrackPage<DbTrack>(trackSort, trackSort === 'recently_added' ? 'desc' : 'asc', cursor, 120), [trackSort]);
  const albums = useTvPage(readAlbums, albumKey);
  const tracks = useTvPage(readTracks, trackKey);
  const page = section === 'albums' ? albums : tracks;
  const keys = section === 'albums' ? albums.items.map(albumKey) : tracks.items.map(trackKey);
  const index = restoredIndex(keys, memory[section].key, memory[section].index);
  const currentPath = usePlayerStore(s => s.currentTrack?.path);
  const firstContent = (section === 'albums' ? albums.items[index] && gridId(albums.items[index]) : tracks.items[index] && trackId(tracks.items[index])) || (page.error ? 'retry' : undefined);
  const entry = `tab:${section}`;
  useEffect(() => setEntry(entry), [entry, setEntry]);
  const { loadMore } = page;
  useEffect(() => { if (index >= page.items.length - 30) loadMore(); }, [index, page.items.length, loadMore]);
  // Refreshes preserve item identity, including the options column. Deleted
  // cells fall to the next real item, or the active tab if the list emptied.
  useEffect(() => {
    const prefix = section === 'albums' ? 'album:' : 'track:';
    if (!focused.startsWith(prefix) || page.loading) return;
    const target = section === 'albums' ? albums.items[index] && gridId(albums.items[index]) : tracks.items[index] && trackId(tracks.items[index], focused.endsWith(':1') ? 1 : 0);
    if (target !== focused) request(target ?? entry);
  }, [focused, section, page.loading, albums.items, tracks.items, index, entry, request]);
  const remember = (key: string, i: number, uri: string | null) => { setMemory(prev => ({ ...prev, [section]: { key, index: i } })); actions.light(artworkThumbFromSource(uri)); };
  const sortLabels = section === 'albums' ? ['Artist A–Z', 'Title A–Z', 'Recently added'] : ['Title A–Z', 'Artist A–Z', 'Recently added'];
  const sortValues = section === 'albums' ? ['artist', 'name', 'recently_added'] : ['title', 'artist', 'recently_added'];
  const selectedSort = sortValues.indexOf(section === 'albums' ? albumSort : trackSort);
  const openSort = () => actions.menu({ title: 'Sort', opener: 'sort', left: 484, top: 108, selected: selectedSort,
    items: sortLabels.map((label, i) => ({ label, selected: i === selectedSort, run: () => {
      setMemory(prev => ({ ...prev, [section]: { key: '', index: 0 } }));
      if (section === 'albums') setAlbumSort(sortValues[i] as AlbumSort); else setTrackSort(sortValues[i] as TrackSort);
    } })) });
  return <>
    <View style={[box(51, 72, 858, 30), { flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
      {['Albums', 'Artists', 'Tracks', 'Playlists', 'Folders'].map(label => {
        const key = label.toLowerCase(); const enabled = key === 'albums' || key === 'tracks';
        return <TvButton key={key} id={`tab:${key}`} label={label} disabled={!enabled} onPress={() => setSection(key as typeof section)}
          links={{ up: 'nav:library', down: firstContent || entry, left: key === 'tracks' ? 'tab:albums' : undefined, right: key === 'albums' ? 'tab:tracks' : 'sort' }}
          style={{ paddingHorizontal: 12, height: 30, backgroundColor: section === key ? tv.fill : 'transparent' }}>
          <TvText color={section === key ? tv.text : tv.muted} weight="medium">{label}</TvText>
        </TvButton>;
      })}
      <TvButton id="sort" label={`Sort, ${sortLabels[selectedSort]}`} onPress={openSort}
        links={{ left: 'tab:tracks', up: 'nav:library', down: firstContent || entry }} style={{ height: 30, paddingHorizontal: 12, marginLeft: 10 }}>
        <TvText size={12}><TvText size={12} color={tv.muted}>Sort  </TvText>{sortLabels[selectedSort]}</TvText>
      </TvButton>
      <TvText mono size={10.5} color={tv.faint} style={{ marginLeft: 'auto' }}>{page.totalCount} {section.toUpperCase()}</TvText>
    </View>
    {!page.items.length ? <View style={box(51, 190, 700)}>
      <TvText size={24} weight="semibold">{page.error ? 'Could not load your library' : page.loading ? 'Loading your library…' : 'Your library is empty'}</TvText>
      <TvText color={tv.muted} style={{ marginTop: 12 }}>{page.error ?? (!page.loading ? 'Music from your configured sources will appear here.' : '')}</TvText>
      {!!page.error && <TvButton id="retry" label="Try again" onPress={page.retry} links={{ up: entry }} style={{ marginTop: 24, width: 140, height: 36, backgroundColor: tv.fill }}><TvText style={{ textAlign: 'center' }}>Try again</TvText></TvButton>}
    </View> : <TvViewport width={960} height={430} style={box(0, 110, 960, 430)}>
      <TvMotion y={section === 'albums' ? -Math.max(0, Math.floor(index / 6) - 1) * 182 : -anchoredStart(index, tracks.items.length, 8, 2) * 52}
        style={{ width: 960, height: 16 + (section === 'albums' ? Math.ceil(albums.items.length / 6) * 182 : tracks.items.length * 52) }}>
      {section === 'albums' ? albums.items.map((album, i) => {
        const firstRow = Math.max(0, Math.floor(index / 6) - 1); const row = Math.floor(i / 6);
        if (row < firstRow - 1 || row > firstRow + 3) return null;
        const neighbor = (direction: 'left' | 'right' | 'up' | 'down') => gridId(albums.items[gridNeighbor(i, albums.items.length, 6, direction)]);
        return <AlbumCard key={album.identity_key} album={album} id={gridId(album)} left={51 + i % 6 * 146.2} top={8 + row * 182}
          links={{ left: neighbor('left'), right: neighbor('right'), down: neighbor('down'), up: row === 0 ? (i === 0 ? 'tab:albums' : i === 1 ? 'tab:tracks' : 'sort') : neighbor('up') }}
          enter={() => remember(album.identity_key, i, albumArtworkSource(album))} open={() => actions.openAlbum(album)} />;
      }) : tracks.items.map((track, i) => {
        const start = anchoredStart(index, tracks.items.length, 8, 2);
        if (i < start - 1 || i > start + 9) return null;
        return <TvTrackRow key={track.path} track={track} id={trackId(track)} optionsId={trackId(track, 1)} top={8 + i * 52} left={51} width={858}
          playing={currentPath === track.path} links={{ up: i ? trackId(tracks.items[i - 1]) : 'sort', down: trackId(tracks.items[Math.min(i + 1, tracks.items.length - 1)]) }}
          optionLinks={{ up: i ? trackId(tracks.items[i - 1], 1) : 'sort', down: trackId(tracks.items[Math.min(i + 1, tracks.items.length - 1)], 1) }}
          enter={() => remember(track.path, i, trackArtworkThumbSource(track))} play={() => actions.playTrack(track, trackSort)}
          options={() => actions.trackMenu(track, trackId(track, 1), 110 + 8 + (i - start) * 52)} />;
      })}
      </TvMotion>
    </TvViewport>}
  </>;
}

export function TvTrackRow({ track, id, optionsId, top, left, width, number, playing, links, optionLinks, enter, play, options }: {
  track: DbTrack; id: string; optionsId: string; top: number; left: number; width: number; number?: number; playing: boolean;
  links: Parameters<typeof TvButton>[0]['links']; optionLinks: Parameters<typeof TvButton>[0]['links']; enter: () => void; play: () => void; options: () => void;
}) {
  const { focused } = useTvFocus(); const hot = focused === id || focused === optionsId;
  return <View style={[box(left, top, width, 49), { borderRadius: 8, backgroundColor: hot ? 'rgba(124,146,196,.08)' : 'transparent' }]}>
    <TvButton id={id} label={`${track.title}, ${track.artist}`} links={{ ...links, right: optionsId }} onFocus={enter} onPress={play}
      style={{ width, height: 49, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      {number === undefined ? <TvArtwork uri={trackArtworkThumbSource(track)} size={34} /> : <TvText mono color={playing ? tv.accent : tv.faint} size={11} style={{ width: 18 }}>{playing ? '▶' : number}</TvText>}
      <View style={{ flex: 1 }}><TvText weight="medium" color={playing ? tv.accent : hot ? tv.strong : tv.caption} numberOfLines={1}>{track.title}</TvText>
        {number === undefined && <TvText size={11} color={tv.muted} numberOfLines={1}>{track.artist}</TvText>}</View>
      {number === undefined && <TvText size={11.5} color={tv.muted} numberOfLines={1} style={{ width: 200 }}>{track.album}</TvText>}
      {number === undefined && <TvText mono size={10.5} color={tv.faint} style={{ width: 86 }}>{track.format.toUpperCase()}</TvText>}
      <TvText mono size={11} color={tv.muted} style={{ width: 46, textAlign: 'right', marginRight: 43 }}>{formatDuration(track.duration)}</TvText>
    </TvButton>
    <TvButton id={optionsId} label={`Options for ${track.title}`} onFocus={enter} onPress={options} links={{ ...optionLinks, left: id }}
      style={{ position: 'absolute', right: 7, top: 9, width: 28, height: 30, alignItems: 'center' }}>
      <TvText size={18} color={focused === optionsId ? tv.strong : tv.muted} style={{ opacity: hot ? 1 : 0 }}>···</TvText>
    </TvButton>
  </View>;
}
