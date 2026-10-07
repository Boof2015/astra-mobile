import { useTvTheme } from './useTvTheme';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, withTiming, useReducedMotion } from 'react-native-reanimated';
import { AstraLibraryData, type NativeFolderNode, type NativePage } from '../../modules/astra-library-scanner';
import { playLibraryQuery } from '@/audio/playbackController';
import { albumArtworkSource, artworkUri, trackArtworkThumbSource } from '@/library/artwork';
import { normalizeKey } from '@/library/artistGrouping';
import { useLibraryStore } from '@/stores/libraryStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerStore } from '@/stores/playerStore';
import type { Album, Artist, DbTrack } from '@/types/library';
import type { Playlist } from '@/types/playlist';
import { TvButton, TvVerticalHoldContext, useTvActive, useTvFocus } from './TvFocus';
import { TvCard, TvArtistArt, TvPlaylistArt } from './TvCards';
import { TvTrackRow } from './TvBrowse';
import { TvFolderRow } from './TvFolders';
import { box, TvArtwork, TvText, TvViewport, TvMotion } from './TvPrimitives';
import { useTvPage, type TvPage } from './useTvPage';
import { gridNeighbor, anchoredStart, restoredIndex } from './focusGeometry';
import { playlistKey, playlistName, type TvPlaylist, type TvActions } from './tvCollections';
import { useTvLetterNavigation } from './useTvLetterNavigation';
import { tvSectionLabel } from './letterNavigation';

type Section = 'albums' | 'artists' | 'tracks' | 'playlists' | 'folders';
type Item = { kind: 'album'; value: Album } | { kind: 'artist'; value: Artist } | { kind: 'track'; value: DbTrack } | { kind: 'playlist'; value: TvPlaylist } | { kind: 'folder'; value: NativeFolderNode };
const sections: Section[] = ['albums', 'artists', 'tracks', 'playlists', 'folders'];
const sorts = {
  albums: ['Artist A–Z', 'Title A–Z', 'Recently added'], artists: ['Name A–Z', 'Most tracks'],
  tracks: ['Title A–Z', 'Artist A–Z', 'Recently added'], playlists: ['Recently updated', 'Name A–Z'], folders: [],
};
const keyOf = (item: Item): string => item.kind === 'album' ? `album:${item.value.identity_key}` : item.kind === 'artist' ? `artist:${normalizeKey(item.value.artist)}`
  : item.kind === 'track' ? `track:${item.value.path}` : item.kind === 'playlist' ? `playlist:${playlistKey(item.value)}` : `folder:${item.value.id}`;
const idOf = (item: Item, options = false) => `library:${keyOf(item)}:${options ? 1 : 0}`;

export function TvLibrary({ actions, setEntry }: { actions: TvActions; setEntry: (id: string) => void }) {
  const tv = useTvTheme();
  const active = useTvActive();
  const { focused, request } = useTvFocus();
  const [section, setSection] = useState<Section>('albums');
  const [sort, setSort] = useState<Record<Section, number>>({ albums: 0, artists: 0, tracks: 0, playlists: 0, folders: 0 });
  const [memory, setMemory] = useState<Partial<Record<Section, { key: string; index: number; options: boolean }>>>({});
  const [windowOrigin, setWindowOrigin] = useState({ key: '', focusedKey: '' });
  const [toolPositions, setToolPositions] = useState({ sort: 445, jump: 580 });
  const grouping = useSettingsStore(s => s.artistGroupingMode);
  const includeSingles = useSettingsStore(s => s.includeSingles);
  const collaborations = useLibraryStore(s => s.includeCollabArtists);
  const playlists = usePlaylistStore(s => s.playlists);
  const favorites = usePlaylistStore(s => s.favoritePaths);
  const revision = useMemo(() => ({ playlists, favorites }), [playlists, favorites]);
  const currentPath = usePlayerStore(s => s.currentTrack?.path);
  const selectedSort = sort[section];
  const alphabetic = section === 'artists' ? selectedSort === 0 : (section === 'tracks' || section === 'albums') && selectedSort < 2;
  const readAt = useCallback(async (cursor: string, before: boolean): Promise<NativePage<Item>> => {
    if (section === 'albums') {
      const order = selectedSort === 0 ? 'artist' : 'name';
      const page = await (before ? AstraLibraryData.getAlbumPageBefore<Album>(order, 'asc', includeSingles, cursor, 120) : AstraLibraryData.getAlbumPage<Album>(order, 'asc', includeSingles, cursor, 120));
      return { ...page, items: page.items.map(value => ({ kind: 'album', value })) };
    }
    if (section === 'artists') {
      const page = await (before ? AstraLibraryData.getArtistPageBefore<Artist>('name', 'asc', grouping, collaborations, cursor, 120) : AstraLibraryData.getArtistPage<Artist>('name', 'asc', grouping, collaborations, cursor, 120));
      return { ...page, items: page.items.map(value => ({ kind: 'artist', value })) };
    }
    const order = selectedSort === 0 ? 'title' : 'artist';
    const page = await (before ? AstraLibraryData.getTrackPageBefore<DbTrack>(order, 'asc', cursor, 120) : AstraLibraryData.getTrackPage<DbTrack>(order, 'asc', cursor, 120));
    return { ...page, items: page.items.map(value => ({ kind: 'track', value })) };
  }, [section, selectedSort, includeSingles, grouping, collaborations]);
  const readBefore = useCallback((cursor: string) => readAt(cursor, true), [readAt]);
  const getAnchors = useCallback(() => {
    if (!alphabetic || section === 'playlists' || section === 'folders') return Promise.resolve([]);
    const order = section === 'artists' ? 'name' : section === 'albums' ? selectedSort === 0 ? 'artist' : 'name' : selectedSort === 0 ? 'title' : 'artist';
    return AstraLibraryData.getSectionAnchors(section, order, 'asc', includeSingles, grouping, collaborations);
  }, [section, alphabetic, selectedSort, includeSingles, grouping, collaborations]);
  const labelOf = useCallback((item: Item) => tvSectionLabel(item.kind === 'album' ? selectedSort === 0 ? item.value.artist : item.value.album
    : item.kind === 'artist' ? item.value.artist : item.kind === 'track' ? selectedSort === 0 ? item.value.title : item.value.artist : ''), [selectedSort]);
  const read = useCallback(async (cursor: string | null): Promise<TvPage<Item>> => {
    if (section === 'albums') {
      const value = (['artist', 'name', 'recently_added'] as const)[selectedSort];
      const page = await AstraLibraryData.getAlbumPage<Album>(value, value === 'recently_added' ? 'desc' : 'asc', includeSingles, cursor, 120);
      return { ...page, items: page.items.map(value => ({ kind: 'album', value })) };
    }
    if (section === 'artists') {
      const page = await AstraLibraryData.getArtistPage<Artist>(selectedSort ? 'track_count' : 'name', selectedSort ? 'desc' : 'asc', grouping, collaborations, cursor, 120);
      return { ...page, items: page.items.map(value => ({ kind: 'artist', value })) };
    }
    if (section === 'tracks') {
      const value = (['title', 'artist', 'recently_added'] as const)[selectedSort];
      const page = await AstraLibraryData.getTrackPage<DbTrack>(value, value === 'recently_added' ? 'desc' : 'asc', cursor, 120);
      return { ...page, items: page.items.map(value => ({ kind: 'track', value })) };
    }
    if (section === 'playlists') {
      const all = await AstraLibraryData.listPlaylists<Playlist>();
      all.sort((a, b) => selectedSort ? a.name.localeCompare(b.name) || a.id - b.id : b.updated_at - a.updated_at || a.id - b.id);
      return { items: [{ kind: 'playlist', value: 'favorites' }, ...all.map(value => ({ kind: 'playlist' as const, value }))], totalCount: all.length + 1, nextCursor: null };
    }
    const nodes = await AstraLibraryData.getFolderNodes(null);
    return { items: nodes.map(value => ({ kind: 'folder', value })), totalCount: nodes.length, nextCursor: null };
  }, [section, selectedSort, includeSingles, grouping, collaborations]);
  const page = useTvPage(read, keyOf, revision, alphabetic ? readBefore : undefined);
  const remembered = memory[section];
  const origin = page.items[0] ? keyOf(page.items[0]) : '';
  // Prepending changes every local row offset, not the viewer's position. Snap
  // that coordinate change; resume motion on the next actual focus movement.
  if (windowOrigin.key !== origin) setWindowOrigin({ key: origin, focusedKey: remembered?.key ?? '' });
  const index = restoredIndex(page.items.map(keyOf), remembered?.key, remembered?.index ?? 0);
  const rememberedItem = page.items[index];
  const first = rememberedItem ? idOf(rememberedItem, remembered?.options && (rememberedItem.kind !== 'folder' || rememberedItem.value.available && rememberedItem.value.totalTrackCount > 0)) : page.error ? 'library:retry' : `tab:${section}`;
  const tools = [...sections.map(s => `tab:${s}`), ...(section !== 'folders' ? ['sort'] : []), ...(alphabetic ? ['jump'] : []), ...(section === 'playlists' ? ['new-playlist'] : section === 'tracks' ? ['shuffle-all'] : []), ...(page.error && page.items.length ? ['library:retry'] : [])];
  const grid = section !== 'tracks' && section !== 'folders';
  const start = grid ? Math.max(0, Math.floor(index / 6) - 1) : anchoredStart(index, page.items.length, 8, 2);
  useEffect(() => { if (active) setEntry(`tab:${section}`); }, [active, section, setEntry]);
  const { loadMore, loadPrevious } = page;
  useEffect(() => { if (active && index >= page.items.length - 30) loadMore(); }, [active, index, page.items.length, loadMore]);
  useEffect(() => { if (active && index < 30) void loadPrevious(); }, [active, index, loadPrevious]);
  useEffect(() => {
    if (active && !page.loading && focused.startsWith('library:') && focused !== first && focused !== 'library:retry') request(first);
  }, [active, page.loading, focused, first, request]);
  const remember = (item: Item, i: number, options = false) => {
    setMemory(prev => ({ ...prev, [section]: { key: keyOf(item), index: i, options } }));
    const uri = item.kind === 'album' ? albumArtworkSource(item.value) : item.kind === 'track' ? trackArtworkThumbSource(item.value)
      : item.kind === 'artist' ? item.value.artwork_hash && artworkUri(item.value.artwork_hash) : item.kind === 'playlist' && item.value !== 'favorites' ? item.value.auto_cover_hash && artworkUri(item.value.auto_cover_hash) : null;
    actions.light(uri);
  };
  const letters = useTvLetterNavigation({ active, alphabetic, contentFocused: focused.startsWith('library:') && focused !== 'library:retry',
    items: page.items, index, previousCursor: page.previousCursor, pageSize: grid ? 12 : 8, keyOf, labelOf, anchors: getAnchors, readAt, readStart: () => read(null),
    replace: page.replaceWindow, more: loadMore, previous: loadPrevious, land: (item, i) => { remember(item, i); request(idOf(item)); }, menu: actions.menu,
    unavailable: () => actions.run(async () => { throw new Error('No matching letter is available.'); }),
  });
  const trackSort = (['title', 'artist', 'recently_added'] as const)[sort.tracks];
  const play = (track?: DbTrack, shuffle = false) => actions.run(() => playLibraryQuery({ kind: 'library', sort: trackSort, direction: trackSort === 'recently_added' ? 'desc' : 'asc' }, { anchorPath: track?.path, shuffle, source: { kind: 'library', label: 'Tracks' } }));
  const openSort = () => actions.menu({ title: 'Sort', opener: 'sort', left: Math.min(toolPositions.sort, 659), top: 108, selected: selectedSort, items: sorts[section].map((label, i) => ({ label, selected: i === selectedSort, run: () => {
    setMemory(prev => ({ ...prev, [section]: { key: '', index: 0, options: false } })); setSort(prev => ({ ...prev, [section]: i }));
  } })) });
  const toolLinks = (id: string) => { const i = tools.indexOf(id); return { left: tools[i - 1], right: tools[i + 1], up: 'nav:library', down: first }; };
  return <>
    <View style={[box(51, 72, 858, 30), { flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
      {sections.map(s => <TvButton key={s} id={`tab:${s}`} label={s[0].toUpperCase() + s.slice(1)} links={toolLinks(`tab:${s}`)} onPress={() => setSection(s)}
        style={{ height: 30, paddingHorizontal: 12, backgroundColor: section === s ? tv.fill : 'transparent' }}><TvText weight="medium" color={section === s ? tv.text : tv.muted}>{s[0].toUpperCase() + s.slice(1)}</TvText></TvButton>)}
      {section !== 'folders' && <TvButton id="sort" label={`Sort, ${sorts[section][selectedSort]}`} links={toolLinks('sort')} onPress={openSort} onLayout={e => { const x = 51 + e.nativeEvent.layout.x; setToolPositions(prev => prev.sort === x ? prev : { ...prev, sort: x }); }} style={{ paddingHorizontal: 12, height: 30, marginLeft: 10 }}>
        <View style={{ position: 'absolute', left: -7, top: 6, bottom: 6, width: 1, backgroundColor: 'rgba(124,146,196,.28)' }} />
        <TvText size={12} weight="medium"><TvText size={12} color={focused === 'sort' ? tv.strong : tv.muted}>Sort  </TvText>{sorts[section][selectedSort]}</TvText></TvButton>}
      {alphabetic && <TvButton id="jump" label="Jump to letter" links={toolLinks('jump')} onPress={() => letters.open(Math.min(toolPositions.jump, 619))} onLayout={e => { const x = 51 + e.nativeEvent.layout.x; setToolPositions(prev => prev.jump === x ? prev : { ...prev, jump: x }); }} style={{ paddingHorizontal: 12, height: 30 }}><TvText size={12} color={focused === 'jump' ? tv.strong : tv.muted}>Jump to letter</TvText></TvButton>}
      {section === 'playlists' && <TvButton id="new-playlist" label="New playlist" links={toolLinks('new-playlist')} onPress={() => actions.namePlaylist()} style={{ paddingHorizontal: 12, height: 30, flexDirection: 'row', alignItems: 'center', gap: 7 }}><Ionicons name="add" size={12} color={focused === 'new-playlist' ? tv.strong : tv.muted} /><TvText size={12} color={focused === 'new-playlist' ? tv.strong : tv.muted}>New playlist</TvText></TvButton>}
      {section === 'tracks' && <TvButton id="shuffle-all" label="Shuffle all" links={toolLinks('shuffle-all')} disabled={!page.items.length} onPress={() => play(undefined, true)} style={{ paddingHorizontal: 12, height: 30, flexDirection: 'row', alignItems: 'center', gap: 7 }}><Ionicons name="shuffle" size={12} color={focused === 'shuffle-all' ? tv.strong : tv.muted} /><TvText size={12} color={focused === 'shuffle-all' ? tv.strong : tv.muted}>Shuffle all</TvText></TvButton>}
      {!!page.error && !!page.items.length && <TvButton id="library:retry" label="Retry loading" links={toolLinks('library:retry')} onPress={page.retry} style={{ height: 30, paddingHorizontal: 8 }}><TvText size={12}>Retry</TvText></TvButton>}
      <TvText mono size={11} color={tv.faint} numberOfLines={1} style={{ marginLeft: 'auto', letterSpacing: .44 }}>{page.totalCount} {section.toUpperCase()}</TvText>
    </View>
    {!page.items.length ? <View style={box(51, 190, 760)}><TvText size={24} weight="semibold">{page.error ? 'Could not load this collection' : page.loading ? 'Loading…' : section === 'folders' ? 'No music locations' : 'Nothing here yet'}</TvText>
      <TvText color={tv.muted} style={{ marginTop: 12 }}>{page.error ?? (section === 'folders' ? 'Your configured local music locations will appear here.' : 'Music from your sources will appear here.')}</TvText>
      {!!page.error && <TvButton id="library:retry" label="Try again" onPress={page.retry} links={{ up: `tab:${section}` }} style={{ width: 140, height: 36, marginTop: 24, backgroundColor: tv.fill }}><TvText style={{ textAlign: 'center' }}>Try again</TvText></TvButton>}
    </View> : <TvVerticalHoldContext.Provider value={section === 'tracks' || section === 'albums' || section === 'artists'}><TvViewport width={960} height={430} topFade={start ? 14 : 0} style={box(0, 110, 960, 430)}><TvMotion instant={letters.instant || windowOrigin.focusedKey === (remembered?.key ?? '')} y={-start * (grid ? 182 : 52)} style={{ width: 960, height: 16 + (grid ? Math.ceil(page.items.length / 6) * 182 : page.items.length * 52) }}>
      {page.items.map((item, i) => {
        const row = grid ? Math.floor(i / 6) : i;
        if (row < start - 1 || row > start + (grid ? 3 : 9)) return null;
        const id = idOf(item); const up = grid ? (row ? idOf(page.items[gridNeighbor(i, page.items.length, 6, 'up')]) : page.previousCursor ? id : tools[Math.min(i % 6, tools.length - 1)]) : i ? idOf(page.items[i - 1]) : page.previousCursor ? id : (section === 'tracks' ? 'sort' : 'tab:folders');
        const down = grid ? idOf(page.items[gridNeighbor(i, page.items.length, 6, 'down')]) : idOf(page.items[Math.min(i + 1, page.items.length - 1)]);
        const links = { up, down, left: grid ? idOf(page.items[gridNeighbor(i, page.items.length, 6, 'left')]) : undefined, right: grid ? idOf(page.items[gridNeighbor(i, page.items.length, 6, 'right')]) : undefined };
        const optionFor = (j: number) => { const neighbor = page.items[j]; return idOf(neighbor, neighbor.kind === 'track' || neighbor.kind === 'folder' && neighbor.value.available && neighbor.value.totalTrackCount > 0); };
        const optionLinks = { up: i ? optionFor(i - 1) : page.previousCursor ? optionFor(i) : (section === 'tracks' ? 'sort' : 'tab:folders'), down: optionFor(Math.min(i + 1, page.items.length - 1)) };
        if (item.kind === 'track') return <TvTrackRow key={id} track={item.value} id={id} optionsId={idOf(item, true)} top={8 + i * 52} left={51} width={858} playing={currentPath === item.value.path}
          links={links} optionLinks={optionLinks} enter={options => remember(item, i, options)} play={() => play(item.value)} options={() => actions.trackMenu(item.value, idOf(item, true), 118 + (i - start) * 52)} />;
        if (item.kind === 'folder') return <TvFolderRow key={id} node={item.value} id={id} optionsId={idOf(item, true)} top={8 + i * 52} links={links} optionLinks={optionLinks}
          enter={options => remember(item, i, options)} open={() => actions.open({ kind: 'folder', node: item.value, breadcrumb: item.value.name })} actions={actions} menuTop={118 + (i - start) * 52} />;
        const title = item.kind === 'album' ? item.value.album : item.kind === 'artist' ? item.value.artist : playlistName(item.value);
        const subtitle = item.kind === 'album' ? item.value.artist : item.kind === 'artist' ? `${item.value.album_count} albums · ${item.value.track_count} tracks` : item.value === 'favorites' ? `${favorites.size} liked tracks` : `${item.value.track_count} tracks${item.value.kind === 'dynamic' ? ' · Dynamic' : ''}`;
        const art = item.kind === 'album' ? <TvArtwork uri={albumArtworkSource(item.value)} size={127} /> : item.kind === 'artist' ? <TvArtistArt artist={item.value} size={127} /> : <TvPlaylistArt playlist={item.value} size={127} />;
        return <TvCard key={id} id={id} title={title} subtitle={subtitle} art={art} left={51 + i % 6 * 146.2} top={8 + row * 182} links={links} enter={() => remember(item, i)}
          open={() => actions.open(item.kind === 'album' ? { kind: 'album', album: item.value } : item.kind === 'artist' ? { kind: 'artist', artist: item.value } : { kind: 'playlist', playlist: item.value })} />;
      })}
    </TvMotion></TvViewport></TvVerticalHoldContext.Provider>}
    <LetterBadge label={letters.badge} />
  </>;
}

function LetterBadge({ label }: { label: string | null }) {
  const tv = useTvTheme();
  const [lastLabel, setLastLabel] = useState('');
  if (label && label !== lastLabel) setLastLabel(label);
  const reduced = useReducedMotion();
  const animated = useAnimatedStyle(() => ({ opacity: withTiming(label ? 1 : 0, { duration: reduced ? 0 : 160 }) }));
  return <Animated.View pointerEvents="none" style={[box(442, 268, 76, 76), { borderRadius: 18, backgroundColor: tv.panel, borderWidth: 1, borderColor: 'rgba(124,146,196,.28)', alignItems: 'center', justifyContent: 'center', elevation: 12 }, animated]}>
    <TvText size={38} weight="semibold" color={tv.strong}>{label ?? lastLabel}</TvText>
  </Animated.View>;
}
