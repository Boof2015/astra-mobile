import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AstraLibraryData, type NativeFolderNode } from '../../modules/astra-library-scanner';
import { playLibraryQuery, enqueueLibraryQuery } from '@/audio/playbackController';
import { usePlayerStore } from '@/stores/playerStore';
import type { DbTrack } from '@/types/library';
import { TvButton, useTvActive, useTvFocus } from './TvFocus';
import { TvTrackRow } from './TvBrowse';
import { TvText, TvMotion, TvViewport, box, tv } from './TvPrimitives';
import { useTvPage } from './useTvPage';
import { anchoredStart, restoredIndex } from './focusGeometry';
import type { DetailProps, TvActions } from './tvCollections';

export function TvFolderRow({ node, id, optionsId, top, links, optionLinks, enter, open, actions, menuTop }: {
  node: NativeFolderNode; id: string; optionsId: string; top: number; links: Parameters<typeof TvButton>[0]['links']; optionLinks: Parameters<typeof TvButton>[0]['links'];
  enter: (options?: boolean) => void; open: () => void; actions: TvActions; menuTop: number;
}) {
  const { focused } = useTvFocus(); const hot = focused === id || focused === optionsId;
  const query = { kind: 'folder' as const, folderNodeId: node.id };
  const playable = node.available && node.totalTrackCount > 0;
  const menu = () => actions.menu({ title: node.name, opener: optionsId, left: 616, top: menuTop, items: [
    { label: 'Play folder', run: () => actions.run(() => playLibraryQuery(query, { source: { kind: 'folder', label: node.name } })) },
    { label: 'Shuffle folder', run: () => actions.run(() => playLibraryQuery(query, { shuffle: true, source: { kind: 'folder', label: node.name } })) },
    { label: 'Add folder to queue', run: () => actions.run(() => enqueueLibraryQuery(query, 'end'), 'Folder added to queue') },
  ] });
  return <View style={[box(51, top, 858, 49), { borderRadius: 8, backgroundColor: hot ? 'rgba(124,146,196,.08)' : 'transparent' }]}>
    <TvButton id={id} label={`Folder ${node.name}`} links={{ ...links, right: playable ? optionsId : undefined }} onFocus={() => enter(false)} onPress={open}
      style={{ height: 49, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
      <Ionicons name={node.depth === 0 ? 'hardware-chip-outline' : 'folder-outline'} size={25} color={tv.muted} />
      <View style={{ flex: 1 }}><TvText weight="medium">{node.name}</TvText><TvText size={11} color={tv.muted}>{node.totalTrackCount} tracks{!node.available ? ' · Location unavailable' : ''}</TvText></View>
      <Ionicons name="chevron-forward" size={16} color={tv.faint} style={{ marginRight: 48 }} />
    </TvButton>
    <TvButton id={optionsId} label={`Options for folder ${node.name}`} disabled={!playable} links={{ ...optionLinks, left: id }} onFocus={() => enter(true)} onPress={menu}
      style={{ position: 'absolute', right: 7, top: 9, width: 28, height: 30, alignItems: 'center' }}><TvText size={18} color={tv.muted} style={{ opacity: hot ? 1 : 0 }}>···</TvText></TvButton>
  </View>;
}

type FolderItem = { kind: 'folder'; value: NativeFolderNode } | { kind: 'track'; value: DbTrack };
const keyOf = (item: FolderItem) => item.kind === 'folder' ? `node:${item.value.id}` : `track:${item.value.path}`;
const idOf = (item: FolderItem, options = false) => `folder:${keyOf(item)}:${options ? 1 : 0}`;

export function TvFolders({ node, breadcrumb, nav, actions, setEntry }: DetailProps & { node: NativeFolderNode; breadcrumb: string }) {
  const active = useTvActive(); const { focused, request } = useTvFocus(); const entered = useRef(false);
  const [memory, setMemory] = useState({ key: '', index: 0, options: false });
  const currentPath = usePlayerStore(s => s.currentTrack?.path);
  const read = useCallback(async (cursor: string | null) => {
    const [children, tracks] = await Promise.all([AstraLibraryData.getFolderNodes(node.id), AstraLibraryData.getFolderTracks<DbTrack>(node.id, Number(cursor ?? 0), 120)]);
    const items: FolderItem[] = [...(cursor === null ? children.map(value => ({ kind: 'folder' as const, value })) : []), ...tracks.items.map(value => ({ kind: 'track' as const, value }))];
    return { items, totalCount: children.length + tracks.totalCount, nextCursor: tracks.nextOffset == null ? null : String(tracks.nextOffset) };
  }, [node.id]);
  const page = useTvPage(read, keyOf);
  const index = restoredIndex(page.items.map(keyOf), memory.key, memory.index);
  const rememberedItem = page.items[index];
  const first = rememberedItem ? idOf(rememberedItem, memory.options && (rememberedItem.kind === 'track' || rememberedItem.value.available && rememberedItem.value.totalTrackCount > 0)) : page.error ? 'folder:retry' : nav;
  const start = anchoredStart(index, page.items.length, 8, 2);
  const parts = breadcrumb.split(' / ');
  const pathLabel = `${parts.length > 2 ? '… / ' : ''}${parts.slice(-2).join(' / ')}`;
  const playable = node.available && node.totalTrackCount > 0;
  useEffect(() => { if (active) setEntry(playable ? 'folder:play' : first); }, [active, first, playable, setEntry]);
  useEffect(() => { if (active && !page.loading && !entered.current) { entered.current = true; request(first); } }, [active, page.loading, first, request]);
  useEffect(() => {
    if (active && !page.loading && (focused.startsWith('folder:node:') || focused.startsWith('folder:track:'))) { if (focused !== first) request(first); }
  }, [active, page.loading, focused, first, request]);
  const { loadMore } = page;
  useEffect(() => { if (active && index >= page.items.length - 25) loadMore(); }, [active, index, page.items.length, loadMore]);
  const play = (track?: DbTrack, shuffle = false) => actions.run(() => playLibraryQuery({ kind: 'folder', folderNodeId: node.id }, { anchorPath: track?.path, shuffle, source: { kind: 'folder', label: node.name } }));
  const remember = (item: FolderItem, i: number, options = false) => setMemory({ key: keyOf(item), index: i, options });
  return <>
    <View style={[box(51, 72, 858, 30), { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
      <TvText weight="semibold">Folders</TvText>
      <TvButton id="folder:play" label="Play folder" disabled={!playable} links={{ up: nav, down: first, right: 'folder:shuffle' }} onPress={() => play()} style={{ paddingHorizontal: 12, height: 30, backgroundColor: tv.fill }}><TvText size={12}>Play folder</TvText></TvButton>
      <TvButton id="folder:shuffle" label="Shuffle folder" disabled={!playable} links={{ up: nav, down: first, left: 'folder:play', right: page.error ? 'folder:retry' : undefined }} onPress={() => play(undefined, true)} style={{ paddingHorizontal: 12, height: 30 }}><TvText size={12}>Shuffle folder</TvText></TvButton>
      {!!page.error && <TvButton id="folder:retry" label="Try again" links={{ up: nav, down: first, left: playable ? 'folder:shuffle' : undefined }} onPress={page.retry} style={{ paddingHorizontal: 12, height: 30 }}><TvText>Retry</TvText></TvButton>}
      <TvText mono size={10.5} color={tv.muted} numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>{pathLabel}</TvText>
    </View>
    {!page.items.length && <View style={box(51, 185, 750)}><TvText size={24}>{page.error ? 'Could not load this folder' : page.loading ? 'Loading…' : 'This folder is empty'}</TvText><TvText color={tv.muted} style={{ marginTop: 12 }}>{page.error ?? (!node.available ? 'This music location is currently unavailable.' : '')}</TvText></View>}
    <TvViewport width={960} height={430} style={box(0, 110, 960, 430)}><TvMotion y={-start * 52} style={{ width: 960, height: 16 + page.items.length * 52 }}>
      {page.items.map((item, i) => {
        if (i < start - 1 || i > start + 9) return null;
        const links = { up: i ? idOf(page.items[i - 1]) : playable ? 'folder:play' : nav, down: idOf(page.items[Math.min(i + 1, page.items.length - 1)]) };
        const optionsFor = (j: number) => { const neighbor = page.items[j]; return idOf(neighbor, neighbor.kind === 'track' || neighbor.value.available && neighbor.value.totalTrackCount > 0); };
        const optionLinks = { up: i ? optionsFor(i - 1) : playable ? 'folder:shuffle' : nav, down: optionsFor(Math.min(i + 1, page.items.length - 1)) };
        if (item.kind === 'folder') return <TvFolderRow key={keyOf(item)} node={item.value} id={idOf(item)} optionsId={idOf(item, true)} top={8 + i * 52} links={links} optionLinks={optionLinks} actions={actions} menuTop={118 + (i - start) * 52}
          enter={options => remember(item, i, options)} open={() => actions.open({ kind: 'folder', node: item.value, breadcrumb: `${breadcrumb} / ${item.value.name}` })} />;
        return <TvTrackRow key={keyOf(item)} track={item.value} id={idOf(item)} optionsId={idOf(item, true)} left={51} top={8 + i * 52} width={858} links={links} optionLinks={optionLinks} playing={item.value.path === currentPath}
          enter={options => remember(item, i, options)} play={() => play(item.value)} options={() => actions.trackMenu(item.value, idOf(item, true), 118 + (i - start) * 52)} />;
      })}
    </TvMotion></TvViewport>
  </>;
}
