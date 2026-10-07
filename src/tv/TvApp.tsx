import { useTvTheme } from './useTvTheme';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AstraLogo } from '@/components/AstraLogo';
import { usePlayerStore } from '@/stores/playerStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerUiStore } from '@/stores/playerUiStore';
import { enqueueEnd, enqueueTop } from '@/audio/playbackController';
import { dbTrackToTrack } from '@/library/trackAdapter';
import { albumArtworkSource, artworkThumbFromSource, artworkUri } from '@/library/artwork';
import { normalizeKey, resolveNavigationArtist } from '@/library/artistGrouping';
import { useSettingsStore } from '@/stores/settingsStore';
import type { Playlist } from '@/types/playlist';
import type { DbTrack } from '@/types/library';
import { TvFocusProvider, TvFocusRegion, TvFocusScope, scopedFocus, TvButton, useTvFocus } from './TvFocus';
import { TvHome, albumFromTrack } from './TvBrowse';
import { TvLibrary } from './TvLibrary';
import { TvSearch } from './TvSearch';
import { TvEq } from './TvEq';
import { TvSettings } from './TvSettings';
import { TvAlbum } from './TvAlbum';
import { TvArtist } from './TvArtist';
import { TvPlaylist } from './TvPlaylist';
import { TvFolders } from './TvFolders';
import { TvNameFlow } from './TvNameFlow';
import type { TvActions, TvDetail, TrackMenu } from './tvCollections';
import { TvNowPlaying } from './TvNowPlaying';
import { TvPanel, type TvMenu } from './TvPanel';
import { TvAtmosphere } from './TvAtmosphere';
import { box, TvFrame, TvArtwork, TvText } from './TvPrimitives';
import { TvBackProvider, useTvBack } from './TvBack';

export function TvApp() {
  return <TvFocusProvider><TvBackProvider><TvFrame><TvShell /></TvFrame></TvBackProvider></TvFocusProvider>;
}

function TvShell() {
  const tv = useTvTheme();
  const { focused, request } = useTvFocus();
  const { handle: localBack } = useTvBack();
  const [page, setPage] = useState<'home' | 'library' | 'search' | 'eq' | 'settings'>('home');
  const [eqImmersive, setEqImmersive] = useState(false);
  const [settingsImmersive, setSettingsImmersive] = useState(false);
  const [settingsEntry, setSettingsEntry] = useState('settings:section:0');
  const [history, setHistory] = useState<{ scope: string; route: TvDetail; opener: string }[]>([]);
  const detail = history.at(-1);
  const sequence = useRef(0);
  const [naming, setNaming] = useState<{ id: number; playlist?: Playlist; opener: string; track?: DbTrack } | null>(null);
  const namingId = useRef<number | null>(null);
  const [menu, setMenu] = useState<TvMenu | null>(null);
  const playerPhase = usePlayerUiStore(s => s.phase);
  const setNowPlaying = useCallback((open: boolean) => {
    if (open) usePlayerUiStore.getState().openPlayer();
    else { usePlayerUiStore.getState().closePlayer(); usePlayerUiStore.getState().commitClosed(); }
  }, []);
  const [homeEntry, setHomeEntry] = useState('nav:library');
  const [libraryEntry, setLibraryEntry] = useState('tab:albums');
  const [searchEntry, setSearchEntry] = useState('search:field');
  const [detailEntry, setDetailEntry] = useState('action:0');
  const [light, setLight] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const track = usePlayerStore(s => s.currentTrack);
  const nowPlaying = !!track && (playerPhase === 'opening' || playerPhase === 'open');
  useEffect(() => {
    if (playerPhase === 'closing') usePlayerUiStore.getState().commitClosed();
  }, [playerPhase]);
  const notify = useCallback((text: string) => {
    setMessage(text);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(''), 4500);
  }, []);
  useEffect(() => () => { if (messageTimer.current) clearTimeout(messageTimer.current); }, []);
  const run = useCallback((operation: () => Promise<void>, success?: string) => {
    void operation().then(() => { if (success) notify(success); }).catch(error => notify(error instanceof Error ? error.message : 'That action could not be completed.'));
  }, [notify]);
  useEffect(() => { void usePlaylistStore.getState().refresh().catch(() => {}); }, []);
  const closeMenu = useCallback(() => { if (menu) { const opener = menu.opener; setMenu(null); request(opener); } }, [menu, request]);
  const cancelNaming = useCallback(() => {
    if (!naming) return;
    namingId.current = null; Keyboard.dismiss(); setNaming(null); request(naming.opener);
  }, [naming, request]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (menu) { closeMenu(); return true; }
      if (naming) { if (Keyboard.isVisible()) Keyboard.dismiss(); else cancelNaming(); return true; }
      if (nowPlaying) { setNowPlaying(false); request('nav:playing'); return true; }
      if (localBack()) return true;
      if (detail) { setHistory(previous => previous.slice(0, -1)); request(detail.opener); return true; }
      if (!focused.startsWith('nav:')) { request(`nav:${page}`); return true; }
      if (page !== 'home') { setPage('home'); request('nav:home'); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [menu, closeMenu, naming, cancelNaming, nowPlaying, detail, focused, page, request, setNowPlaying, localBack]);
  const open = (route: TvDetail, opener = focused) => {
    const entry = { route, opener, scope: String(++sequence.current) };
    setHistory(previous => [...previous, entry]);
  };
  const namePlaylist = (playlist?: Playlist, opener = menu?.opener ?? focused, pendingTrack?: DbTrack) => {
    const id = ++sequence.current; namingId.current = id;
    setNaming({ id, playlist, opener, track: pendingTrack });
  };
  const deletePlaylist = (playlist: Playlist, opener: string) => setMenu({ title: 'Delete playlist?', message: `Delete “${playlist.name}”? Your music files will be kept.`, opener, left: 270, top: 300, items: [
    { label: 'Cancel', run: () => {} },
    { label: 'Delete playlist', run: () => run(async () => {
      await usePlaylistStore.getState().deletePlaylist(playlist.id);
      const index = history.findIndex(entry => entry.route.kind === 'playlist' && entry.route.playlist !== 'favorites' && entry.route.playlist.id === playlist.id);
      if (index >= 0) {
        setHistory(previous => previous.slice(0, index));
        // The deleted tile no longer exists. Return to its collection toolbar.
        request(index ? history[index].opener : page === 'library' ? 'tab:playlists' : page === 'search' ? 'search:field' : 'nav:home');
      }
    }, 'Playlist deleted') },
  ] });
  const trackMenu: TrackMenu = (dbTrack, opener, top, extra = []) => {
    const converted = dbTrackToTrack(dbTrack);
    const artist = resolveNavigationArtist(dbTrack, useSettingsStore.getState().artistGroupingMode);
    const favoriteLabel = usePlaylistStore.getState().favoritePaths.has(dbTrack.path) ? 'Remove from Favorites' : 'Add to Favorites';
    setMenu({ title: dbTrack.title, opener, left: 616, top, items: [
      { label: 'Play next', run: () => run(() => enqueueTop(converted), 'Playing next') },
      { label: 'Add to queue', run: () => run(() => enqueueEnd(converted), 'Added to queue') },
      ...(detail?.route.kind === 'album' && detail.route.album.identity_key === dbTrack.album_identity_key ? [] : [{ label: 'Go to album', run: () => open({ kind: 'album', album: albumFromTrack(dbTrack) }, opener) }]),
      ...(detail?.route.kind === 'artist' && normalizeKey(detail.route.artist.artist) === normalizeKey(artist) ? [] : [{ label: 'Go to artist', run: () => open({ kind: 'artist', artist: { artist, track_count: 0, primary_track_count: 0, album_count: 0, artwork_hash: dbTrack.artwork_hash, artwork_source: 'track', artwork_hashes: dbTrack.artwork_hash ? [dbTrack.artwork_hash] : [] } }, opener) }]),
      { label: 'Add to playlist', run: () => setMenu({ title: 'Add to playlist', opener, left: 616, top, items: [
        { label: 'New playlist', run: () => namePlaylist(undefined, opener, dbTrack) },
        ...usePlaylistStore.getState().playlists.filter(p => p.kind === 'normal').map(p => ({ label: p.name, run: () => run(async () => { const added = await usePlaylistStore.getState().addTracksToPlaylist(p.id, [dbTrack]); notify(added ? `Added to ${p.name}` : 'Already in this playlist'); }) })),
      ] }) },
      ...(!extra.some(item => item.label === favoriteLabel) ? [{ label: favoriteLabel, run: () => run(() => usePlaylistStore.getState().toggleFavorite(dbTrack)) }] : []),
      ...extra,
    ] });
  };
  const actions: TvActions = { open, light: setLight, menu: setMenu, trackMenu, run, namePlaylist, deletePlaylist };
  const submitName = async (name: string) => {
    if (!naming) return;
    const store = usePlaylistStore.getState();
    if (naming.playlist) await store.renamePlaylist(naming.playlist.id, name);
    else {
      const playlist = await store.createPlaylist(name);
      if (naming.track) await usePlaylistStore.getState().addTracksToPlaylist(playlist.id, [naming.track]);
      if (namingId.current === naming.id) open({ kind: 'playlist', playlist }, naming.opener === 'new-playlist' ? `library:playlist:${playlist.id}:0` : naming.opener);
    }
    if (namingId.current !== naming.id) return;
    namingId.current = null; Keyboard.dismiss(); setNaming(null);
    if (naming.playlist) request(naming.opener);
  };
  const enter = detail ? detailEntry : page === 'home' ? homeEntry : page === 'library' ? libraryEntry : page === 'eq' ? 'eq:tool:parametric' : page === 'settings' ? settingsEntry : searchEntry;
  const route = detail?.route;
  const detailArt = route?.kind === 'album' ? artworkThumbFromSource(albumArtworkSource(route.album))
    : route?.kind === 'artist' ? route.artist.artwork_hash && artworkUri(route.artist.artwork_hash)
    : route?.kind === 'playlist' && route.playlist !== 'favorites' ? route.playlist.auto_cover_hash && artworkUri(route.playlist.auto_cover_hash) : null;
  return <>
    <TvAtmosphere uri={detail ? detailArt : light} strength={detail ? .5 : page === 'home' ? .4 : page === 'settings' || page === 'eq' || page === 'search' && !light ? .34 : .3} />
    <TvFocusRegion enabled={!menu && !nowPlaying && !detail && !naming}>
      <View style={[StyleSheet.absoluteFill, { display: detail || nowPlaying ? 'none' : 'flex' }]}>
        <TvFocusRegion enabled={!menu && !nowPlaying && !detail && page === 'home'}><View style={[StyleSheet.absoluteFill, { display: page === 'home' ? 'flex' : 'none' }]}><TvHome actions={actions} setEntry={setHomeEntry} /></View></TvFocusRegion>
        <TvFocusRegion enabled={!menu && !nowPlaying && !detail && page === 'library'}><View style={[StyleSheet.absoluteFill, { display: page === 'library' ? 'flex' : 'none' }]}><TvLibrary actions={actions} setEntry={setLibraryEntry} /></View></TvFocusRegion>
        <TvFocusRegion enabled={page === 'search'}><View style={[StyleSheet.absoluteFill, { display: page === 'search' ? 'flex' : 'none' }]}><TvSearch actions={actions} setEntry={setSearchEntry} /></View></TvFocusRegion>
        <TvFocusRegion enabled={page === 'eq'}><View style={[StyleSheet.absoluteFill, { display: page === 'eq' ? 'flex' : 'none' }]}><TvEq actions={actions} setImmersive={setEqImmersive} /></View></TvFocusRegion>
        <TvFocusRegion enabled={page === 'settings'}><View style={[StyleSheet.absoluteFill, { display: page === 'settings' ? 'flex' : 'none' }]}><TvSettings actions={actions} setEntry={setSettingsEntry} setImmersive={setSettingsImmersive} /></View></TvFocusRegion>
      </View>
    </TvFocusRegion>
    {history.map(entry => <TvFocusRegion key={entry.scope} enabled={entry === detail && !menu && !nowPlaying && !naming}><View style={[StyleSheet.absoluteFill, { display: entry === detail && !nowPlaying ? 'flex' : 'none' }]}>
      <TvFocusScope scope={entry.scope}><DetailPage route={entry.route} scope={entry.scope} nav={`nav:${page}`} actions={actions} setEntry={setDetailEntry} /></TvFocusScope>
    </View></TvFocusRegion>)}
    {!nowPlaying && !naming && !eqImmersive && !settingsImmersive && <TvFocusRegion enabled={!menu}>
      <View style={[box(51, 27, 858, 30), { flexDirection: 'row', alignItems: 'center' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginRight: 26 }}><AstraLogo size={22} color="#00b3ff" /><TvText size={15} weight="semibold" style={{ letterSpacing: 3.3 }}>ASTRA</TvText></View>
        {['Home', 'Library', 'Search', 'EQ', 'Settings'].map(label => {
          const key = label.toLowerCase();
          return <TvButton key={key} id={`nav:${key}`} label={label}
            onPress={() => { setHistory([]); setPage(key as typeof page); }} links={{ down: enter, left: key === 'library' ? 'nav:home' : key === 'search' ? 'nav:library' : key === 'eq' ? 'nav:search' : key === 'settings' ? 'nav:eq' : undefined, right: key === 'home' ? 'nav:library' : key === 'library' ? 'nav:search' : key === 'search' ? 'nav:eq' : key === 'eq' ? 'nav:settings' : track ? 'nav:playing' : undefined }}
            style={{ height: 30, paddingHorizontal: 12, marginRight: 4, backgroundColor: page === key ? tv.fill : 'transparent' }}>
            <TvText size={16.5} weight="medium" color={page === key ? tv.text : tv.muted}>{label}</TvText>
          </TvButton>;
        })}
        {track && <TvButton id="nav:playing" label={`Now playing, ${track.title}`} onPress={() => setNowPlaying(true)} links={{ left: 'nav:settings', down: enter }}
          style={{ height: 40, marginLeft: 'auto', paddingLeft: 5, paddingRight: 12, flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderColor: tv.border, borderRadius: 11, backgroundColor: tv.surface, maxWidth: 222 }}>
          <TvArtwork uri={track.artworkData} size={30} /><View style={{ maxWidth: 136 }}><TvText size={13.5} weight="semibold" numberOfLines={1}>{track.title}</TvText><TvText size={12} color={tv.muted} numberOfLines={1}>{track.artist}</TvText></View><PlayingMark />
        </TvButton>}
      </View>
    </TvFocusRegion>}
    {nowPlaying && <TvNowPlaying run={run} />}
    {naming && <View style={StyleSheet.absoluteFill}><TvNameFlow key={naming.id} initial={naming.playlist?.name} submit={submitName} cancel={cancelNaming} /></View>}
    {!!message && <View pointerEvents="none" style={[box(270, 482, 420, 38), { borderRadius: 8, backgroundColor: tv.surface, alignItems: 'center', justifyContent: 'center' }]}><TvText numberOfLines={2}>{message}</TvText></View>}
    {menu && <TvPanel menu={menu} close={closeMenu} />}
  </>;
}

function DetailPage({ route, scope, nav, actions, setEntry }: { route: TvDetail; scope: string; nav: string; actions: TvActions; setEntry: (key: string) => void }) {
  const entry = useCallback((key: string) => setEntry(scopedFocus(scope, key)), [scope, setEntry]);
  const local: TvActions = { ...actions,
    menu: menu => actions.menu({ ...menu, opener: scopedFocus(scope, menu.opener) }),
    trackMenu: (track, opener, top, extra) => actions.trackMenu(track, scopedFocus(scope, opener), top, extra),
    deletePlaylist: (playlist, opener) => actions.deletePlaylist(playlist, scopedFocus(scope, opener)),
  };
  const props = { nav, actions: local, setEntry: entry };
  if (route.kind === 'album') return <TvAlbum album={route.album} nav={nav} trackMenu={local.trackMenu} run={local.run} setEntry={entry} />;
  if (route.kind === 'artist') return <TvArtist artist={route.artist} {...props} />;
  if (route.kind === 'playlist') return <TvPlaylist playlist={route.playlist} {...props} />;
  return <TvFolders node={route.node} breadcrumb={route.breadcrumb} {...props} />;
}

function PlayingMark() {
  const tv = useTvTheme();
  const playing = usePlayerStore(s => s.playbackState === 'playing');
  return <Ionicons name={playing ? 'stats-chart' : 'pause'} size={13} color={tv.accent} />;
}
