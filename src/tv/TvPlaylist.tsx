import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import { enqueueLibraryQuery, playLibraryQuery } from '@/audio/playbackController';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerStore } from '@/stores/playerStore';
import { formatDuration } from '@/lib/format';
import type { DbTrack } from '@/types/library';
import type { PlaylistTrackEntry } from '@/types/playlist';
import { TvPlaylistArt } from './TvCards';
import { TvTrackRow } from './TvBrowse';
import { TvButton, useTvActive, useTvFocus } from './TvFocus';
import { box, tv, TvText, TvViewport, TvMotion } from './TvPrimitives';
import { useTvPage } from './useTvPage';
import { anchoredStart, restoredIndex } from './focusGeometry';
import { playlistName, playlistQuery, type DetailProps, type TvPlaylist as PlaylistCollection } from './tvCollections';

const keyOf = (entry: PlaylistTrackEntry) => entry.track_path;
const idOf = (entry: PlaylistTrackEntry, options = false) => `playlist:item:${entry.track_path}:${options ? 1 : 0}`;

export function TvPlaylist({ playlist: initial, nav, actions, setEntry }: DetailProps & { playlist: PlaylistCollection }) {
  const active = useTvActive(); const { focused, request } = useTvFocus(); const entered = useRef(false);
  const playlists = usePlaylistStore(s => s.playlists);
  const favorites = usePlaylistStore(s => s.favoritePaths);
  const currentPath = usePlayerStore(s => s.currentTrack?.path);
  const revision = useMemo(() => ({ playlists, favorites }), [playlists, favorites]);
  const playlist = initial === 'favorites' ? initial : playlists.find(p => p.id === initial.id) ?? initial;
  const id = playlist === 'favorites' ? null : playlist.id;
  const [memory, setMemory] = useState({ key: '', index: 0, options: false });
  const read = useCallback(async (cursor: string | null) => {
    const offset = Number(cursor ?? 0);
    if (id != null) {
      const page = await AstraLibraryData.getPlaylistEntries<PlaylistTrackEntry>(id, offset, 120);
      return { ...page, nextCursor: page.nextOffset == null ? null : String(page.nextOffset) };
    }
    // The existing getFavoriteTracks API caps at 500. Page the full path list so
    // TV never silently truncates Favorites or loses unavailable entries.
    const paths = await AstraLibraryData.getFavoritePaths();
    const items = await Promise.all(paths.slice(offset, offset + 120).map(async (path, i): Promise<PlaylistTrackEntry> => ({
      id: offset + i, track_path: path, position: offset + i, added_at: 0, missing: false,
      fallback_title: null, fallback_artist: null, fallback_album: null, track: await AstraLibraryData.getTrack<DbTrack>(path),
    })));
    return { items, totalCount: paths.length, nextCursor: offset + items.length < paths.length ? String(offset + items.length) : null };
  }, [id]);
  const page = useTvPage(read, keyOf, revision);
  const index = restoredIndex(page.items.map(keyOf), memory.key || currentPath, memory.index);
  const first = page.items[index] ? idOf(page.items[index], memory.options) : 'playlist:options';
  const start = anchoredStart(index, page.items.length, page.error ? 7 : 8, 3);
  const playable = page.items.some(entry => entry.track) || !!page.nextCursor && playlist !== 'favorites' && playlist.track_count > 0;
  const canRemove = playlist === 'favorites' || playlist.kind !== 'dynamic';
  const name = playlistName(playlist);
  useEffect(() => { if (active) setEntry(playable ? 'action:0' : 'playlist:options'); }, [active, playable, setEntry]);
  useEffect(() => { if (active && !page.loading && !entered.current) { entered.current = true; request(playable ? 'action:0' : 'playlist:options'); } }, [active, page.loading, playable, request]);
  useEffect(() => { if (active && !page.loading && (focused.startsWith('playlist:item:') || !playable && focused.startsWith('action:')) && focused !== first) request(first); }, [active, page.loading, playable, focused, first, request]);
  const { loadMore } = page;
  useEffect(() => { if (active && index >= page.items.length - 25) loadMore(); }, [active, index, page.items.length, loadMore]);
  const play = (track?: DbTrack, shuffle = false) => actions.run(async () => {
    await playLibraryQuery(playlistQuery(playlist), { anchorPath: track?.path, shuffle, source: { kind: id == null ? 'favorites' : 'playlist', label: name } });
    if (id != null) await usePlaylistStore.getState().markPlayed(id);
  });
  const remove = (entry: PlaylistTrackEntry) => actions.run(async () => {
    if (id == null) await usePlaylistStore.getState().toggleFavorite({ path: entry.track_path });
    else await usePlaylistStore.getState().removeFromPlaylist(id, entry.track_path);
  }, id == null ? 'Removed from Favorites' : 'Removed from playlist');
  const options = () => actions.menu({ title: name, opener: 'playlist:options', left: 270, top: 352, items: [
    ...(playlist === 'favorites' || playlist.kind !== 'dynamic' ? [{ label: 'Reorder tracks', disabled: true, run: () => {} }] : []),
    ...(playlist === 'favorites' ? [] : [
      { label: 'Rename', run: () => actions.namePlaylist(playlist) },
      { label: 'Delete playlist', run: () => actions.deletePlaylist(playlist, 'playlist:options') },
    ]),
  ] });
  const menuFor = (entry: PlaylistTrackEntry, top: number) => {
    const extra = canRemove ? [{ label: id == null ? 'Remove from Favorites' : 'Remove from playlist', run: () => remove(entry) }] : [];
    if (entry.track) actions.trackMenu(entry.track, idOf(entry, true), top, extra);
    else actions.menu({ title: entry.fallback_title ?? 'Unavailable track', message: 'This track is no longer available in your library.', opener: idOf(entry, true), left: 616, top, items: extra.length ? extra : [{ label: 'Done', run: () => {} }] });
  };
  const buttons = [{ label: 'Play', run: () => play() }, { label: 'Shuffle', run: () => play(undefined, true) }, { label: 'Add to queue', run: () => actions.run(() => enqueueLibraryQuery(playlistQuery(playlist), 'end'), 'Playlist added to queue') }];
  return <>
    <View style={box(51, 80, 172, 172)}><TvPlaylistArt playlist={playlist} size={172} /></View>
    <TvText mono size={10.5} color={tv.accent} style={[box(51, 268, 210), { letterSpacing: 1.6 }]}>{playlist !== 'favorites' && playlist.kind === 'dynamic' ? 'DYNAMIC PLAYLIST' : 'PLAYLIST'}</TvText>
    <TvText size={26} weight="semibold" numberOfLines={1} style={[box(51, 284, 228), { lineHeight: 30 }]}>{name}</TvText>
    <TvText size={12} color={tv.muted} style={box(51, 324, 228)}>{page.totalCount} tracks{!page.nextCursor && page.items.length ? ` · ${formatDuration(page.items.reduce((sum, entry) => sum + (entry.track?.duration ?? 0), 0))}` : ''}</TvText>
    <TvText mono size={10.5} color={tv.muted} style={box(51, 346, 228)}>{playlist === 'favorites' ? 'YOUR LIKED TRACKS' : `UPDATED ${new Date(playlist.updated_at).toLocaleDateString()}`}</TvText>
    {buttons.map((button, i) => <TvButton key={button.label} id={`action:${i}`} label={button.label} disabled={!playable} onPress={button.run} links={{ up: i ? `action:${i - 1}` : nav, down: i < 2 ? `action:${i + 1}` : 'playlist:options', right: first }}
      style={[box(51, 373 + i * 36, 196, 32), { paddingHorizontal: 12, backgroundColor: i ? 'rgba(124,146,196,.07)' : tv.fill, borderWidth: 1, borderColor: tv.border }]}><TvText color={i ? tv.text : tv.accent}>{button.label}</TvText></TvButton>)}
    <TvButton id="playlist:options" label="Playlist options" onPress={options} links={{ up: playable ? 'action:2' : nav, right: page.error ? 'playlist:retry' : first }} style={[box(51, 481, 196, 32), { paddingHorizontal: 12, backgroundColor: tv.fill }]}><TvText>Playlist options</TvText></TvButton>
    {!!page.error && <TvButton id="playlist:retry" label="Try again" onPress={page.retry} links={{ left: 'playlist:options', up: nav, down: first }} style={[box(299, 76, 140, 30), { backgroundColor: tv.fill, paddingHorizontal: 12 }]}><TvText>Try again</TvText></TvButton>}
    <TvViewport width={626} height={page.error ? 428 : 464} topFade={8} style={box(291, page.error ? 112 : 76, 626, page.error ? 428 : 464)}>
      {!page.items.length && <View style={box(16, 76, 575)}><TvText size={24} weight="semibold">{page.error ? 'Could not load this playlist' : page.loading ? 'Loading…' : 'This playlist is empty'}</TvText>
        <TvText color={tv.muted} style={{ marginTop: 12 }}>{page.error ?? 'Add tracks from a track’s options menu.'}</TvText></View>}
      <TvMotion y={-start * 52} style={{ width: 626, height: 16 + page.items.length * 52 }}>
        {page.items.map((entry, i) => {
          if (i < start - 1 || i > start + 9) return null;
          const links = { left: playable ? 'action:0' : 'playlist:options', up: i ? idOf(page.items[i - 1]) : page.error ? 'playlist:retry' : nav, down: idOf(page.items[Math.min(i + 1, page.items.length - 1)]) };
          const optionLinks = { up: i ? idOf(page.items[i - 1], true) : page.error ? 'playlist:retry' : nav, down: idOf(page.items[Math.min(i + 1, page.items.length - 1)], true) };
          const remember = (options = false) => setMemory({ key: entry.track_path, index: i, options });
          if (entry.track) return <TvTrackRow key={entry.track_path} track={entry.track} compact id={idOf(entry)} optionsId={idOf(entry, true)} left={8} width={602} top={8 + i * 52} playing={entry.track.path === currentPath} links={links} optionLinks={optionLinks} enter={remember}
            play={() => play(entry.track!)} options={() => menuFor(entry, 84 + (i - start) * 52)} />;
          return <View key={entry.track_path} style={box(8, 8 + i * 52, 602, 49)}>
            <TvButton id={idOf(entry)} label={`Unavailable, ${entry.fallback_title ?? 'Track'}`} links={{ ...links, right: idOf(entry, true) }} onFocus={() => remember()} onPress={() => menuFor(entry, 84 + (i - start) * 52)} style={{ height: 49, paddingHorizontal: 12 }}>
              <TvText color={tv.muted}>{entry.fallback_title ?? 'Unavailable track'}</TvText><TvText size={11} color={tv.faint}>{canRemove ? 'Unavailable · Open options to remove' : 'Unavailable'}</TvText></TvButton>
            <TvButton id={idOf(entry, true)} label={`Options for ${entry.fallback_title ?? 'unavailable track'}`} links={{ ...optionLinks, left: idOf(entry) }} onFocus={() => remember(true)} onPress={() => menuFor(entry, 84 + (i - start) * 52)} style={{ position: 'absolute', right: 7, top: 9, height: 30, width: 28, alignItems: 'center' }}><TvText>···</TvText></TvButton>
          </View>;
        })}
      </TvMotion>
    </TvViewport>
  </>;
}
