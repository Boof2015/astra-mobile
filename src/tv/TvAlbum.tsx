import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import type { Album, DbTrack } from '@/types/library';
import type { NativeAlbumSummary } from '@/library/nativePages';
import { albumArtworkSource } from '@/library/artwork';
import { usePlayerStore } from '@/stores/playerStore';
import { enqueueLibraryQuery, playLibraryQuery } from '@/audio/playbackController';
import { formatDuration } from '@/lib/format';
import { useTvPage } from './useTvPage';
import { TvButton, useTvFocus } from './TvFocus';
import { TvTrackRow } from './TvBrowse';
import { box, tv, TvArtwork, TvText, TvMotion, TvViewport } from './TvPrimitives';
import { anchoredStart, restoredIndex } from './focusGeometry';

const keyOf = (track: DbTrack) => track.path;
const idOf = (track: DbTrack, col = 0) => `detail:${track.path}:${col}`;

export function TvAlbum({ album, nav, trackMenu, run, setEntry }: {
  album: Album; nav: string; trackMenu: (track: DbTrack, opener: string, top: number) => void;
  run: (operation: () => Promise<void>, success?: string) => void;
  setEntry: (key: string) => void;
}) {
  const { request, focused } = useTvFocus();
  const read = useCallback((cursor: string | null) => AstraLibraryData.getAlbumDetail<DbTrack, NativeAlbumSummary>(album.identity_key, cursor, 120), [album.identity_key]);
  const page = useTvPage(read, keyOf);
  const [memory, setMemory] = useState({ key: '', index: 0 });
  const [titleLines, setTitleLines] = useState(1);
  const currentPath = usePlayerStore(s => s.currentTrack?.path);
  const index = restoredIndex(page.items.map(keyOf), memory.key || currentPath, memory.index);
  const start = anchoredStart(index, page.items.length, 8, 3);
  const content = page.items[index] ? idOf(page.items[index]) : 'action:0';
  useEffect(() => { request('action:0'); }, [request]);
  const entry = page.items.length ? 'action:0' : page.error ? 'album:retry' : nav;
  useEffect(() => { setEntry(entry); }, [entry, setEntry]);
  useEffect(() => { if (!page.loading && !page.items.length) request(entry); }, [page.loading, page.items.length, entry, request]);
  const { loadMore } = page;
  useEffect(() => { if (index >= page.items.length - 25) loadMore(); }, [index, page.items.length, loadMore]);
  useEffect(() => {
    if (page.loading || !focused.startsWith('detail:')) return;
    const target = page.items[index] ? idOf(page.items[index], focused.endsWith(':1') ? 1 : 0) : 'action:0';
    if (target !== focused) request(page.items.length ? target : nav);
  }, [page.items, index, page.loading, focused, request, nav]);
  const play = (track?: DbTrack, shuffle = false) => run(() => playLibraryQuery({ kind: 'album', albumKey: album.identity_key }, {
    anchorPath: track?.path, shuffle, source: { kind: 'album', label: album.album },
  }));
  const buttons = [
    { title: 'Play', icon: '▶', action: () => play() },
    { title: 'Shuffle', icon: '⇄', action: () => play(undefined, true) },
    { title: 'Add to queue', icon: '+', action: () => run(() => enqueueLibraryQuery({ kind: 'album', albumKey: album.identity_key }, 'end'), 'Album added to queue') },
  ];
  return <>
    <TvArtwork uri={albumArtworkSource(page.summary ?? album)} size={196} style={box(51, 80, 196, 196)} />
    <TvText mono size={10.5} color={tv.accent} style={[box(51, 292, 196), { letterSpacing: 1.6 }]}>ALBUM</TvText>
    <TvText size={26} weight="semibold" numberOfLines={2} onTextLayout={event => setTitleLines(Math.min(2, event.nativeEvent.lines.length))} style={[box(51, 308, 228), { lineHeight: 30 }]}>{album.album}</TvText>
    <TvText size={13} color={tv.muted} numberOfLines={1} style={box(51, 314 + titleLines * 30, 216)}>{album.artist}</TvText>
    <TvText mono size={10.5} color={tv.muted} style={box(51, 336 + titleLines * 30, 216)}>{page.totalCount || album.track_count} tracks · {formatDuration(page.summary?.total_duration ?? page.items.reduce((sum, track) => sum + track.duration, 0))}</TvText>
    {buttons.map((button, i) => <TvButton key={button.title} id={`action:${i}`} label={button.title} disabled={!page.items.length}
      links={{ up: i ? `action:${i - 1}` : nav, down: i < 2 ? `action:${i + 1}` : undefined, right: content }} onPress={button.action}
      style={[box(51, 409 + i * 36, 196, 32), { top: 409 + i * 36, paddingHorizontal: 12, backgroundColor: i === 0 ? tv.fill : 'rgba(124,146,196,.07)', borderWidth: 1, borderColor: tv.border }]}>
      <TvText color={i === 0 ? tv.accent : tv.text}>{button.icon}   {button.title}</TvText>
    </TvButton>)}
    <TvViewport width={626} height={464} topFade={8} style={box(291, 76, 626, 464)}>
      <TvMotion y={-start * 52} style={{ width: 626, height: 16 + page.items.length * 52 }}>
      {page.items.map((track, i) => i < start - 1 || i > start + 9 ? null : <TvTrackRow key={track.path} track={track} id={idOf(track)} optionsId={idOf(track, 1)}
        left={8} width={602} top={8 + i * 52} number={i + 1} playing={track.path === currentPath}
        links={{ left: 'action:0', up: i ? idOf(page.items[i - 1]) : nav, down: idOf(page.items[Math.min(i + 1, page.items.length - 1)]) }}
        optionLinks={{ up: i ? idOf(page.items[i - 1], 1) : nav, down: idOf(page.items[Math.min(i + 1, page.items.length - 1)], 1) }}
        enter={() => setMemory({ key: track.path, index: i })} play={() => play(track)}
        options={() => trackMenu(track, idOf(track, 1), 84 + (i - start) * 52)} />)}
      </TvMotion>
      {!page.items.length && <View style={box(16, 40, 560)}>
        <TvText size={20}>{page.error ? 'Could not load this album' : page.loading ? 'Loading album…' : 'No tracks available'}</TvText>
        {!!page.error && <TvButton id="album:retry" label="Try again" onPress={page.retry} links={{ up: nav, left: nav }} style={{ width: 150, height: 36, marginTop: 20, backgroundColor: tv.fill }}><TvText>Try again</TvText></TvButton>}
      </View>}
    </TvViewport>
  </>;
}
