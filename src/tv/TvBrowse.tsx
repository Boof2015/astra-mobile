import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, withTiming } from 'react-native-reanimated';
import { albumArtworkSource, artworkThumbFromSource, trackArtworkThumbSource } from '@/library/artwork';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import type { Album, DbTrack } from '@/types/library';
import { formatDuration } from '@/lib/format';
import { restoredIndex, shelfOffset } from './focusGeometry';
import { TvButton, useTvFocus } from './TvFocus';
import { box, tv, TvArtwork, TvText, TvMotion, TvViewport } from './TvPrimitives';
import { TvCard, TvPlaylistArt } from './TvCards';
import { playlistKey, playlistName, type TvActions, type TvPlaylist as Playlist } from './tvCollections';

type HomeItem = { kind: 'album'; value: Album } | { kind: 'playlist'; value: Playlist };
const itemKey = (item: HomeItem) => item.kind === 'album' ? item.value.identity_key : playlistKey(item.value);

export function albumFromTrack(track: DbTrack): Album {
  return { identity_key: track.album_identity_key, album: track.album, artist: track.album_display_artist ?? track.album_artist ?? track.artist,
    artwork_hash: track.artwork_hash, source_type: track.source_type, source_id: track.source_id, artwork_source_id: track.artwork_source_id,
    track_count: track.track_total ?? 0, latest_added_at: track.added_at, year: track.year };
}

export function AlbumCard({ album, id, left, top, links, enter, open }: {
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

export function TvHome({ actions, setEntry }: { actions: TvActions; setEntry: (key: string) => void }) {
  const added = useLibraryStore(s => s.homeAlbums);
  const recentTracks = useLibraryStore(s => s.recentlyPlayedTracks);
  const recent = [...new Map(recentTracks.map(track => [track.album_identity_key, albumFromTrack(track)])).values()];
  const playlists = usePlaylistStore(s => s.playlists);
  const rows: { title: string; items: HomeItem[] }[] = [
    { title: 'Recently played', items: recent.map(value => ({ kind: 'album' as const, value })) },
    { title: 'Your playlists', items: ['favorites' as const, ...playlists].map(value => ({ kind: 'playlist' as const, value })) },
    { title: 'Recently added', items: added.map(value => ({ kind: 'album' as const, value })) },
  ].filter(row => row.items.length);
  const [activeRow, setActiveRow] = useState('Recently played');
  const [memory, setMemory] = useState<Record<string, { key: string; index: number }>>({});
  const rowIndex = Math.max(0, rows.findIndex(row => row.title === activeRow));
  const indexFor = (r: number) => restoredIndex(rows[r].items.map(itemKey), memory[rows[r].title]?.key, memory[rows[r].title]?.index ?? 0);
  const idFor = (r: number, i: number) => `home:${rows[r].title}:${itemKey(rows[r].items[i])}`;
  const row = rows[rowIndex];
  const item = row?.items[indexFor(rowIndex)];
  const entry = row ? idFor(rowIndex, indexFor(rowIndex)) : 'nav:library';
  useEffect(() => setEntry(entry), [entry, setEntry]);
  return <>
    <TvText mono size={10.5} color={tv.accent} style={[box(51, 88, 600), { letterSpacing: 1.6 }]}>{item ? 'FROM YOUR COLLECTION' : 'YOUR MUSIC, ON TV'}</TvText>
    <TvText size={34} weight="semibold" numberOfLines={1} style={[box(51, 102, 740), { lineHeight: 40 }]}>{item?.kind === 'album' ? item.value.album : item ? playlistName(item.value) : 'Welcome to Astra'}</TvText>
    <TvText size={14} color={tv.muted} style={box(51, 148, 740)}>{item?.kind === 'album' ? item.value.artist : item ? item.value === 'favorites' ? 'Your liked tracks' : 'Your playlist' : 'Open Library to browse your collection.'}</TvText>
    {item?.kind === 'album' && !!item.value.track_count && <TvText mono size={11.5} color={tv.muted} style={box(51, 174, 740)}>{item.value.track_count} tracks{item.value.year ? ` · ${item.value.year}` : ''}</TvText>}
    <TvViewport width={960} height={540} topFade={0} bottomFade={52} style={box(0, 0, 960, 540)}>
    {rows.map((row, r) => <TvMotion key={row.title} y={-rowIndex * 213} style={[box(0, 206 + r * 213, 960, 206), { opacity: r < rowIndex ? 0 : 1 }]}>
      <TvText size={15} weight="semibold" color={r === rowIndex ? tv.strong : tv.muted} style={box(51, 0, 800)}>{row.title}</TvText>
      <TvViewport width={960} height={184} shelf style={box(0, 22, 960, 184)}>
        <TvMotion x={-shelfOffset(indexFor(r), row.items.length)} style={{ width: 102 + row.items.length * 146.2, height: 184 }}>
        {row.items.map((item, i) => {
          const left = 51 + i * 146.2 - shelfOffset(indexFor(r), row.items.length);
          if (left < -180 || left > 1100) return null;
          const links = { left: idFor(r, Math.max(0, i - 1)), right: idFor(r, Math.min(row.items.length - 1, i + 1)),
            up: r === 0 ? 'nav:home' : idFor(r - 1, indexFor(r - 1)), down: r < rows.length - 1 ? idFor(r + 1, indexFor(r + 1)) : undefined };
          const enter = () => { setActiveRow(row.title); setMemory(prev => ({ ...prev, [row.title]: { key: itemKey(item), index: i } })); actions.light(item.kind === 'album' ? artworkThumbFromSource(albumArtworkSource(item.value)) : null); };
          const open = () => actions.open(item.kind === 'album' ? { kind: 'album', album: item.value } : { kind: 'playlist', playlist: item.value });
          return item.kind === 'album' ? <AlbumCard key={itemKey(item)} album={item.value} id={idFor(r, i)} left={51 + i * 146.2} top={8} links={links} enter={enter} open={open} />
            : <TvCard key={itemKey(item)} id={idFor(r, i)} left={51 + i * 146.2} top={8} title={playlistName(item.value)} subtitle={item.value === 'favorites' ? 'Your liked tracks' : `${item.value.track_count} tracks`} art={<TvPlaylistArt playlist={item.value} size={127} />} links={links} enter={enter} open={open} />;
        })}
        </TvMotion>
      </TvViewport>
    </TvMotion>)}
    </TvViewport>
  </>;
}

export function TvTrackRow({ track, id, optionsId, top, left, width, number, compact = false, secondary = track.artist, playing, links, optionLinks, enter, play, options }: {
  track: DbTrack; id: string; optionsId: string; top: number; left: number; width: number; number?: number; compact?: boolean; secondary?: string; playing: boolean;
  links: Parameters<typeof TvButton>[0]['links']; optionLinks: Parameters<typeof TvButton>[0]['links']; enter: (options?: boolean) => void; play: () => void; options: () => void;
}) {
  const { focused } = useTvFocus(); const hot = focused === id || focused === optionsId;
  return <View style={[box(left, top, width, 49), { borderRadius: 8, backgroundColor: hot ? 'rgba(124,146,196,.08)' : 'transparent' }]}>
    <TvButton id={id} label={`${track.title}, ${track.artist}`} links={{ ...links, right: optionsId }} onFocus={() => enter(false)} onPress={play}
      style={{ width, height: 49, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      {number === undefined ? <TvArtwork uri={trackArtworkThumbSource(track)} size={34} /> : <TvText mono color={playing ? tv.accent : tv.faint} size={11} style={{ width: 18 }}>{playing ? '▶' : number}</TvText>}
      <View style={{ flex: 1 }}><TvText weight="medium" color={playing ? tv.accent : hot ? tv.strong : tv.caption} numberOfLines={1}>{track.title}</TvText>
        {number === undefined && <TvText size={11} color={tv.muted} numberOfLines={1}>{secondary}</TvText>}</View>
      {number === undefined && !compact && <TvText size={11.5} color={tv.muted} numberOfLines={1} style={{ width: 200 }}>{track.album}</TvText>}
      {number === undefined && !compact && <TvText mono size={10.5} color={tv.faint} style={{ width: 86 }}>{track.format.toUpperCase()}</TvText>}
      <TvText mono size={11} color={tv.muted} style={{ width: 46, textAlign: 'right', marginRight: 43 }}>{formatDuration(track.duration)}</TvText>
    </TvButton>
    <TvButton id={optionsId} label={`Options for ${track.title}`} onFocus={() => enter(true)} onPress={options} links={{ ...optionLinks, left: id }}
      style={{ position: 'absolute', right: 7, top: 9, width: 28, height: 30, alignItems: 'center' }}>
      <TvText size={18} color={focused === optionsId ? tv.strong : tv.muted} style={{ opacity: hot ? 1 : 0 }}>···</TvText>
    </TvButton>
  </View>;
}
