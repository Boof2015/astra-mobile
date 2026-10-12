import { useTvTheme } from './useTvTheme';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import { playLibraryQuery, enqueueLibraryQuery } from '@/audio/playbackController';
import { normalizeKey } from '@/library/artistGrouping';
import { albumArtworkSource } from './artwork';
import { useSettingsStore } from '@/stores/settingsStore';
import { usePlayerStore } from '@/stores/playerStore';
import type { Album, Artist, DbTrack } from '@/types/library';
import { TvArtistArt, TvCard } from './TvCards';
import { TvTrackRow, albumFromTrack } from './TvBrowse';
import { TvButton, useTvActive, useTvFocus } from './TvFocus';
import { box, TvArtwork, TvText, TvViewport, TvMotion } from './TvPrimitives';
import { useTvPage } from './useTvPage';
import { gridNeighbor, anchoredStart, restoredIndex } from './focusGeometry';
import type { DetailProps } from './tvCollections';

const albumKey = (album: Album) => album.identity_key;
const trackKey = (track: DbTrack) => track.path;
type Section = 'releases' | 'appearances' | 'tracks';

export function TvArtist({ artist, nav, actions, setEntry }: DetailProps & { artist: Artist }) {
  const tv = useTvTheme();
  const active = useTvActive(); const { focused, request } = useTvFocus(); const entered = useRef(false);
  const grouping = useSettingsStore(s => s.artistGroupingMode);
  const currentPath = usePlayerStore(s => s.currentTrack?.path);
  const [section, setSection] = useState<Section>('releases');
  const [memory, setMemory] = useState<Partial<Record<Section, { key: string; index: number; options: boolean }>>>({});
  const [titleLines, setTitleLines] = useState(1);
  const artistKey = normalizeKey(artist.artist);
  const primary = useRef(artist.primary_track_count > 0);
  const readReleases = useCallback(async (cursor: string | null) => {
    const page = await AstraLibraryData.getArtistAlbums<Album>(artistKey, grouping, Number(cursor ?? 0), 120);
    return { ...page, nextCursor: page.nextOffset == null ? null : String(page.nextOffset) };
  }, [artistKey, grouping]);
  const readTracks = useCallback(async (cursor: string | null) => {
    const result = await AstraLibraryData.getArtistDetail<DbTrack, Artist>(artistKey, grouping,
      section === 'appearances' ? 'appearances' : primary.current ? 'songs' : 'all', cursor, 120);
    // A track-menu route initially knows only the artist's name. Resolve the
    // primary/guest relationship before publishing its first track window.
    if (cursor === null && section !== 'appearances' && result.summary && primary.current !== (result.summary.primary_track_count > 0)) {
      primary.current = result.summary.primary_track_count > 0;
      return AstraLibraryData.getArtistDetail<DbTrack, Artist>(artistKey, grouping, primary.current ? 'songs' : 'all', null, 120);
    }
    return result;
  }, [artistKey, grouping, section]);
  const releases = useTvPage(readReleases, albumKey);
  const tracks = useTvPage(readTracks, trackKey);
  const summary = tracks.summary ?? artist;
  const tabs: Section[] = ['releases', ...(grouping === 'astra' && summary.track_count > summary.primary_track_count ? ['appearances' as const] : []), 'tracks'];
  const albums = section === 'appearances' ? [...new Map(tracks.items.map(track => [track.album_identity_key, albumFromTrack(track)])).values()] : releases.items;
  const page = section === 'releases' ? releases : tracks;
  const keys = section === 'tracks' ? tracks.items.map(trackKey) : albums.map(albumKey);
  const mem = memory[section]; const index = restoredIndex(keys, mem?.key ?? (section === 'tracks' ? currentPath : undefined), mem?.index ?? 0);
  const idFor = (i: number, options = false) => `artist:${section}:${keys[i]}:${options ? 1 : 0}`;
  const tab = `artist-tab:${section}`;
  const first = keys[index] ? idFor(index, mem?.options) : page.error ? 'artist:retry' : tab;
  const start = section === 'tracks' ? anchoredStart(index, keys.length, 7, 3) : Math.max(0, Math.floor(index / 4) - 1);
  const playable = summary.track_count > 0;
  useEffect(() => { if (active) setEntry(playable ? 'action:0' : tab); }, [active, playable, tab, setEntry]);
  useEffect(() => { if (active && !tracks.loading && !releases.loading && !entered.current) { entered.current = true; request(playable ? 'action:0' : tab); } }, [active, tracks.loading, releases.loading, playable, tab, request]);
  useEffect(() => { if (active && !page.loading && focused.startsWith(`artist:${section}:`) && focused !== first) request(first); }, [active, page.loading, section, focused, first, request]);
  const { loadMore } = page;
  useEffect(() => { if (active && index >= keys.length - 12) loadMore(); }, [active, index, keys.length, loadMore]);
  const query = { kind: 'artist' as const, artistKey, groupingMode: grouping, section: section === 'appearances' ? 'appearances' as const : summary.primary_track_count ? 'songs' as const : 'all' as const };
  const play = (track?: DbTrack, shuffle = false) => actions.run(() => playLibraryQuery(query, { anchorPath: track?.path, shuffle, source: { kind: 'artist', label: artist.artist } }));
  const buttons = [
    { label: 'Play', run: () => play() }, { label: 'Shuffle', run: () => play(undefined, true) },
    { label: 'Add to queue', run: () => actions.run(() => enqueueLibraryQuery(query, 'end'), 'Artist added to queue') },
  ];
  return <>
    <View style={box(51, 80, 172, 172)}><TvArtistArt artist={summary} size={172} /></View>
    <TvText mono size={10.5} color={tv.accent} style={[box(51, 268, 210), { letterSpacing: 1.6 }]}>ARTIST</TvText>
    <TvText size={26} weight="semibold" numberOfLines={2} onTextLayout={e => setTitleLines(Math.min(2, e.nativeEvent.lines.length))} style={[box(51, 284, 228), { lineHeight: 30 }]}>{summary.artist}</TvText>
    <TvText size={12} color={tv.muted} style={box(51, 294 + titleLines * 30, 228)}>{summary.album_count} albums · {summary.track_count} tracks</TvText>
    {buttons.map((button, i) => <TvButton key={button.label} id={`action:${i}`} label={button.label} disabled={!playable} onPress={button.run} links={{ up: i ? `action:${i - 1}` : nav, down: i < 2 ? `action:${i + 1}` : undefined, right: first }}
      style={[box(51, 409 + i * 36, 196, 32), { paddingHorizontal: 12, backgroundColor: i ? tv.hover : tv.fill, borderWidth: 1, borderColor: tv.border }]}><TvText color={i ? tv.text : tv.accent}>{button.label}</TvText></TvButton>)}
    <View style={[box(307, 76, 594, 30), { flexDirection: 'row', gap: 6 }]}>
      {tabs.map((t, i) => <TvButton key={t} id={`artist-tab:${t}`} label={t === 'releases' ? 'Releases' : t === 'appearances' ? 'Appears on' : 'Artist tracks'} onPress={() => setSection(t)}
        links={{ up: nav, left: i ? `artist-tab:${tabs[i - 1]}` : 'action:0', right: tabs[i + 1] ? `artist-tab:${tabs[i + 1]}` : page.error ? 'artist:retry' : undefined, down: first }}
        style={{ paddingHorizontal: 12, height: 30, backgroundColor: section === t ? tv.fill : 'transparent' }}><TvText>{t === 'releases' ? 'Releases' : t === 'appearances' ? 'Appears on' : 'Tracks'}</TvText></TvButton>)}
      {!!page.error && <TvButton id="artist:retry" label="Try again" onPress={page.retry} links={{ up: nav, left: `artist-tab:${tabs[tabs.length - 1]}`, down: first }} style={{ height: 30, paddingHorizontal: 10 }}><TvText>Retry</TvText></TvButton>}
    </View>
    <TvViewport width={626} height={428} topFade={start ? 8 : 0} style={box(291, 112, 626, 428)}>
      {!keys.length && <View style={box(16, 42, 575)}><TvText size={20}>{page.error ? 'Could not load this collection' : page.loading ? 'Loading…' : section === 'releases' ? 'No releases as the primary artist' : 'No tracks here'}</TvText></View>}
      <TvMotion y={-start * (section === 'tracks' ? 52 : 182)} style={{ width: 626, height: 16 + (section === 'tracks' ? keys.length * 52 : Math.ceil(keys.length / 4) * 182) }}>
        {section === 'tracks' ? tracks.items.map((track, i) => i < start - 1 || i > start + 8 ? null : <TvTrackRow key={track.path} track={track} id={idFor(i)} optionsId={idFor(i, true)} left={8} top={8 + i * 52} width={602} compact
          secondary={track.album} playing={track.path === currentPath} links={{ left: 'action:0', up: i ? idFor(i - 1) : tab, down: idFor(Math.min(i + 1, keys.length - 1)) }} optionLinks={{ up: i ? idFor(i - 1, true) : tab, down: idFor(Math.min(i + 1, keys.length - 1), true) }}
          enter={options => setMemory(prev => ({ ...prev, [section]: { key: track.path, index: i, options: !!options } }))} play={() => play(track)} options={() => actions.trackMenu(track, idFor(i, true), 120 + (i - start) * 52)} />)
          : albums.map((album, i) => {
            const row = Math.floor(i / 4); if (row < start - 1 || row > start + 3) return null;
            return <TvCard key={album.identity_key} id={idFor(i)} title={album.album} subtitle={album.artist} art={<TvArtwork uri={albumArtworkSource(album)} size={127} />} left={16 + i % 4 * 146.2} top={8 + row * 182}
              links={{ left: i % 4 ? idFor(i - 1) : 'action:0', right: idFor(gridNeighbor(i, albums.length, 4, 'right')), up: row ? idFor(gridNeighbor(i, albums.length, 4, 'up')) : `artist-tab:${tabs[Math.min(i % 4, tabs.length - 1)]}`, down: idFor(gridNeighbor(i, albums.length, 4, 'down')) }}
              enter={() => setMemory(prev => ({ ...prev, [section]: { key: album.identity_key, index: i, options: false } }))} open={() => actions.open({ kind: 'album', album })} />;
          })}
      </TvMotion>
    </TvViewport>
  </>;
}
