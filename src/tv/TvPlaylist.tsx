import { useTvTheme } from './useTvTheme';
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
import { TvPlaylistRow } from './TvPlaylistRow';
import { useTvBackHandler } from './TvBack';
import { createPlaylistReorder, type ReorderState } from './playlistReorder';
import { TvButton, useTvActive, useTvFocus } from './TvFocus';
import { box, TvText, TvViewport, TvMotion } from './TvPrimitives';
import { useTvPage } from './useTvPage';
import { anchoredStart, restoredIndex } from './focusGeometry';
import { playlistName, playlistQuery, type DetailProps, type TvPlaylist as PlaylistCollection } from './tvCollections';

const keyOf = (entry: PlaylistTrackEntry) => entry.track_path;
const idOf = (entry: PlaylistTrackEntry, options = false) => `playlist:item:${entry.track_path}:${options ? 1 : 0}`;

export function TvPlaylist({ playlist: initial, nav, actions, setEntry }: DetailProps & { playlist: PlaylistCollection }) {
  const tv = useTvTheme();
  const active = useTvActive(); const { focused, request } = useTvFocus(); const entered = useRef(false);
  const playlists = usePlaylistStore(s => s.playlists);
  const favorites = usePlaylistStore(s => s.favoritePaths);
  const currentPath = usePlayerStore(s => s.currentTrack?.path);
  const revision = useMemo(() => ({ playlists, favorites }), [playlists, favorites]);
  const playlist = initial === 'favorites' ? initial : playlists.find(p => p.id === initial.id) ?? initial;
  const id = playlist === 'favorites' ? null : playlist.id;
  const [memory, setMemory] = useState({ key: '', index: 0, options: false });
  const [removed, setRemoved] = useState<{ key: string; index: number } | null>(null);
  const restoredRemoval = useRef<typeof removed>(null);
  const [reorder, setReorder] = useState<ReorderState<PlaylistTrackEntry> | null>(null);
  const reorderSession = useRef<ReturnType<typeof createPlaylistReorder<PlaylistTrackEntry>> | null>(null);
  useEffect(() => () => { reorderSession.current?.dispose(); reorderSession.current = null; }, []);
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
  const rows = reorder?.items ?? page.items;
  const index = restoredIndex(rows.map(keyOf), reorder?.focusedKey ?? (memory.key || currentPath), memory.index);
  const hasOptions = playlist !== 'favorites';
  const fallback = hasOptions ? 'playlist:options' : nav;
  const first = rows[index] ? idOf(rows[index], !reorder && memory.options) : fallback;
  const start = anchoredStart(index, rows.length, reorder || page.error ? 7 : 8, 3);
  const playable = page.items.some(entry => entry.track) || !!page.nextCursor && playlist !== 'favorites' && playlist.track_count > 0;
  const canRemove = playlist === 'favorites' || playlist.kind !== 'dynamic';
  const canReorder = playlist !== 'favorites' && playlist.kind !== 'dynamic' && rows.length > 1;
  const defaultEntry = page.error ? 'playlist:retry' : playable ? 'action:0' : hasOptions ? 'playlist:options' : first;
  const name = playlistName(playlist);
  useEffect(() => { if (active) setEntry(reorder ? first : defaultEntry); }, [active, reorder, first, defaultEntry, setEntry]);
  useEffect(() => { if (active && !page.loading && !entered.current) { entered.current = true; request(defaultEntry); } }, [active, page.loading, defaultEntry, request]);
  useEffect(() => { if (active && !page.loading && (focused.startsWith('playlist:item:') || !playable && focused.startsWith('action:')) && focused !== first) request(first); }, [active, page.loading, playable, focused, first, request]);
  useEffect(() => {
    if (!active || !removed || restoredRemoval.current === removed || page.loading || page.items.some(entry => entry.track_path === removed.key)) return;
    const nextIndex = Math.max(0, Math.min(removed.index, page.items.length - 1));
    const next = page.items[nextIndex];
    restoredRemoval.current = removed;
    // The resulting native onFocus records the new selection as usual.
    request(next ? idOf(next, true) : fallback);
  }, [active, removed, page.loading, page.items, fallback, request]);
  const { loadMore } = page;
  useEffect(() => { if (active && !reorder && index >= page.items.length - 25) loadMore(); }, [active, reorder, index, page.items.length, loadMore]);
  const reorderLength = reorder?.items.length;
  useEffect(() => { if (active && reorderLength != null && index >= reorderLength - 25) reorderSession.current?.loadMore(); }, [active, index, reorderLength]);
  const startReorder = () => {
    if (!canReorder || id == null) return;
    const item = rows[index];
    const session = createPlaylistReorder({ initial: { items: page.items, nextCursor: page.nextCursor, totalCount: page.totalCount }, focusedKey: item.track_path, keyOf, read,
      write: (key, direction) => AstraLibraryData.movePlaylistEntry(id, key, direction), changed: setReorder,
      failed: reason => actions.run(async () => { throw reason; }),
    });
    reorderSession.current = session;
    setMemory({ key: item.track_path, index, options: false });
    setReorder(session.snapshot()); request(idOf(item));
  };
  const finishReorder = () => {
    const session = reorderSession.current;
    if (!session || session.snapshot().finishing) return;
    actions.run(async () => {
      const result = await session.finish();
      if (reorderSession.current !== session) return;
      const key = session.snapshot().focusedKey;
      page.replaceWindow(result, () => read(null));
      setMemory({ key, index: restoredIndex(result.items.map(keyOf), key, index), options: false });
      session.dispose(); reorderSession.current = null; setReorder(null);
      request('playlist:options');
      await usePlaylistStore.getState().refresh();
    });
  };
  const directionInReorder = (direction: -1 | 1) => {
    const session = reorderSession.current;
    if (!session) return;
    const state = session.snapshot();
    if (state.finishing) return;
    if (state.grabbed) { session.move(direction); return; }
    const at = state.items.findIndex(entry => entry.track_path === state.focusedKey);
    const target = state.items[Math.max(0, Math.min(at + direction, state.items.length - 1))];
    if (target) { session.focus(target.track_path); request(idOf(target)); }
  };
  useTvBackHandler(active && !!reorder, () => {
    const session = reorderSession.current;
    if (session?.snapshot().grabbed) session.drop(); else finishReorder();
    return true;
  });
  const play = (track?: DbTrack, shuffle = false) => actions.run(async () => {
    await playLibraryQuery(playlistQuery(playlist), { anchorPath: track?.path, shuffle, source: { kind: id == null ? 'favorites' : 'playlist', label: name } });
    if (id != null) await usePlaylistStore.getState().markPlayed(id);
  });
  const remove = (entry: PlaylistTrackEntry) => actions.run(async () => {
    const at = rows.findIndex(item => item.track_path === entry.track_path);
    if (id == null) await usePlaylistStore.getState().toggleFavorite({ path: entry.track_path });
    else await usePlaylistStore.getState().removeFromPlaylist(id, entry.track_path);
    // Wait for the refreshed rows to commit before restoring the opener's
    // neighbor. An earlier request can be lost when Android removes that view.
    setRemoved({ key: entry.track_path, index: at });
  }, id == null ? 'Removed from Favorites' : 'Removed from playlist');
  const options = () => actions.menu({ title: name, opener: 'playlist:options', left: 270, top: 352, items: [
    ...(canReorder ? [{ label: 'Reorder tracks', run: startReorder }] : []),
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
    {buttons.map((button, i) => <TvButton key={button.label} id={`action:${i}`} label={button.label} disabled={!playable || !!reorder} onPress={button.run} links={{ up: i ? `action:${i - 1}` : nav, down: i < 2 ? `action:${i + 1}` : hasOptions ? 'playlist:options' : undefined, right: first }}
      style={[box(51, (hasOptions ? 373 : 409) + i * 36, 196, 32), { paddingHorizontal: 12, backgroundColor: i ? tv.hover : tv.fill, borderWidth: 1, borderColor: tv.border }]}><TvText color={i ? tv.text : tv.accent}>{button.label}</TvText></TvButton>)}
    {hasOptions && <TvButton id="playlist:options" label="Playlist options" disabled={!!reorder} onPress={options} links={{ up: playable ? 'action:2' : nav, right: page.error ? 'playlist:retry' : first }} style={[box(51, 481, 196, 32), { paddingHorizontal: 12, backgroundColor: tv.fill }]}><TvText>Playlist options</TvText></TvButton>}
    {!!page.error && <TvButton id="playlist:retry" label="Try again" onPress={page.retry} links={{ left: fallback, up: nav, down: first }} style={[box(299, 76, 140, 30), { backgroundColor: tv.fill, paddingHorizontal: 12 }]}><TvText>Try again</TvText></TvButton>}
    <TvViewport width={626} height={reorder ? 410 : page.error ? 428 : 464} topFade={8} bottomFade={reorder ? 24 : 46} style={box(291, !reorder && page.error ? 112 : 76, 626, reorder ? 410 : page.error ? 428 : 464)}>
      {!page.items.length && <View style={box(16, 76, 575)}><TvText size={24} weight="semibold">{page.error ? 'Could not load this playlist' : page.loading ? 'Loading…' : 'This playlist is empty'}</TvText>
        <TvText color={tv.muted} style={{ marginTop: 12 }}>{page.error ?? 'Add tracks from a track’s options menu.'}</TvText></View>}
      <TvMotion y={-start * 52} style={{ width: 626, height: 16 + rows.length * 52 }}>
        {rows.map((entry, i) => {
          if (i < start - 2 || i > start + 9) return null;
          const links = { left: playable ? 'action:0' : fallback, up: i ? idOf(rows[i - 1]) : reorder ? idOf(entry) : page.error ? 'playlist:retry' : nav, down: idOf(rows[Math.min(i + 1, rows.length - 1)]) };
          const optionLinks = { up: i ? idOf(rows[i - 1], true) : page.error ? 'playlist:retry' : nav, down: idOf(rows[Math.min(i + 1, rows.length - 1)], true) };
          // Editing owns the selected identity. Android can briefly refocus a
          // sibling when a lifted view changes drawing order; that must not
          // replace the row selected by the remote.
          const remember = (options = false) => { if (!reorderSession.current) setMemory({ key: entry.track_path, index: i, options }); };
          const menuTop = 84 + (i - start) * 52;
          return <TvPlaylistRow key={entry.track_path} entry={entry} id={idOf(entry)} optionsId={idOf(entry, true)} index={i} playing={entry.track_path === currentPath}
            links={links} optionLinks={optionLinks} editing={!!reorder} grabbed={!!reorder?.grabbed && reorder.focusedKey === entry.track_path} locked={!!reorder?.finishing}
            enter={remember} press={() => reorder ? reorderSession.current?.toggleGrab() : entry.track ? play(entry.track) : menuFor(entry, menuTop)}
            options={() => menuFor(entry, menuTop)} move={directionInReorder} />;
        })}
      </TvMotion>
    </TvViewport>
    {!!reorder && <View style={[box(307, 484, 602, 34), { borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: tv.panel, borderWidth: 1, borderColor: 'rgba(124,146,196,.28)' }]}>
      <TvText size={12} weight="semibold" color={tv.accent}>{reorder.finishing ? 'Saving…' : 'Reordering'}</TvText>
      <TvText size={12} color={tv.muted}><TvText size={12} weight="semibold">OK</TvText> pick up / drop</TvText>
      <TvText size={12} color={tv.muted}><TvText size={12} weight="semibold">▲ ▼</TvText> move</TvText>
      <TvText size={12} color={tv.muted}><TvText size={12} weight="semibold">Back</TvText> {reorder.grabbed ? 'drop' : 'done'}</TvText>
    </View>}
  </>;
}
