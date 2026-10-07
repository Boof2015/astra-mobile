import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AstraLogo } from '@/components/AstraLogo';
import { usePlayerStore } from '@/stores/playerStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerUiStore } from '@/stores/playerUiStore';
import { enqueueEnd, enqueueTop, playLibraryQuery } from '@/audio/playbackController';
import { dbTrackToTrack } from '@/library/trackAdapter';
import { albumArtworkSource, artworkThumbFromSource } from '@/library/artwork';
import type { Album, DbTrack } from '@/types/library';
import { TvFocusProvider, TvFocusRegion, TvButton, useTvFocus } from './TvFocus';
import { TvHome, TvLibrary, albumFromTrack, type BrowseActions } from './TvBrowse';
import { TvAlbum } from './TvAlbum';
import { TvNowPlaying } from './TvNowPlaying';
import { TvPanel, type TvMenu } from './TvPanel';
import { TvAtmosphere } from './TvAtmosphere';
import { box, tv, TvFrame, TvArtwork, TvText } from './TvPrimitives';

export function TvApp() {
  return <TvFocusProvider><TvFrame><TvShell /></TvFrame></TvFocusProvider>;
}

function TvShell() {
  const { focused, request } = useTvFocus();
  const [page, setPage] = useState<'home' | 'library'>('home');
  const [detail, setDetail] = useState<{ album: Album; opener: string } | null>(null);
  const [menu, setMenu] = useState<TvMenu | null>(null);
  const playerPhase = usePlayerUiStore(s => s.phase);
  const setNowPlaying = useCallback((open: boolean) => {
    if (open) usePlayerUiStore.getState().openPlayer();
    else { usePlayerUiStore.getState().closePlayer(); usePlayerUiStore.getState().commitClosed(); }
  }, []);
  const [homeEntry, setHomeEntry] = useState('nav:library');
  const [libraryEntry, setLibraryEntry] = useState('tab:albums');
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
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (menu) { closeMenu(); return true; }
      if (nowPlaying) { setNowPlaying(false); request('nav:playing'); return true; }
      if (detail) { const opener = detail.opener; setDetail(null); request(opener); return true; }
      if (!focused.startsWith('nav:')) { request(`nav:${page}`); return true; }
      if (page !== 'home') { setPage('home'); request('nav:home'); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [menu, closeMenu, nowPlaying, detail, focused, page, request, setNowPlaying]);
  const openAlbum = (album: Album) => { setDetail({ album, opener: focused }); };
  const trackMenu = (dbTrack: DbTrack, opener: string, top: number) => {
    const converted = dbTrackToTrack(dbTrack);
    setMenu({ title: dbTrack.title, opener, left: 616, top, items: [
      { label: 'Play next', run: () => run(() => enqueueTop(converted), 'Playing next') },
      { label: 'Add to queue', run: () => run(() => enqueueEnd(converted), 'Added to queue') },
      ...(!detail ? [{ label: 'Go to album', run: () => setDetail({ album: albumFromTrack(dbTrack), opener }) }] : []),
      { label: usePlaylistStore.getState().favoritePaths.has(dbTrack.path) ? 'Remove from Favorites' : 'Add to Favorites', run: () => run(() => usePlaylistStore.getState().toggleFavorite(dbTrack)) },
    ] });
  };
  const actions: BrowseActions = { openAlbum, light: setLight, menu: setMenu, trackMenu,
    playTrack: (dbTrack, sort) => run(() => playLibraryQuery({ kind: 'library', sort, direction: sort === 'recently_added' ? 'desc' : 'asc' }, { anchorPath: dbTrack.path, source: { kind: 'library', label: 'Tracks' } })) };
  const enter = detail ? detailEntry : page === 'home' ? homeEntry : libraryEntry;
  return <>
    <TvAtmosphere uri={detail ? artworkThumbFromSource(albumArtworkSource(detail.album)) : light} strength={detail ? .5 : page === 'home' ? .4 : .3} />
    <TvFocusRegion enabled={!menu && !nowPlaying && !detail}>
      <View style={[StyleSheet.absoluteFill, { display: detail || nowPlaying ? 'none' : 'flex' }]}>
        <TvFocusRegion enabled={!menu && !nowPlaying && !detail && page === 'home'}><View style={[StyleSheet.absoluteFill, { display: page === 'home' ? 'flex' : 'none' }]}><TvHome actions={actions} setEntry={setHomeEntry} /></View></TvFocusRegion>
        <TvFocusRegion enabled={!menu && !nowPlaying && !detail && page === 'library'}><View style={[StyleSheet.absoluteFill, { display: page === 'library' ? 'flex' : 'none' }]}><TvLibrary actions={actions} setEntry={setLibraryEntry} /></View></TvFocusRegion>
      </View>
    </TvFocusRegion>
    {detail && <TvFocusRegion enabled={!menu && !nowPlaying}><View style={[StyleSheet.absoluteFill, { display: nowPlaying ? 'none' : 'flex' }]}>
      <TvAlbum key={detail.album.identity_key} album={detail.album} nav={`nav:${page}`} trackMenu={trackMenu} run={run} setEntry={setDetailEntry} />
    </View></TvFocusRegion>}
    {!nowPlaying && <TvFocusRegion enabled={!menu}>
      <View style={[box(51, 27, 858, 30), { flexDirection: 'row', alignItems: 'center' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginRight: 26 }}><AstraLogo size={22} color="#00b3ff" /><TvText size={15} weight="semibold" style={{ letterSpacing: 3.3 }}>ASTRA</TvText></View>
        {['Home', 'Library', 'Search', 'EQ', 'Settings'].map(label => {
          const key = label.toLowerCase(); const enabled = key === 'home' || key === 'library';
          return <TvButton key={key} id={`nav:${key}`} label={label} disabled={!enabled}
            onPress={() => { setDetail(null); setPage(key as typeof page); }} links={{ down: enter, left: key === 'library' ? 'nav:home' : undefined, right: key === 'home' ? 'nav:library' : track ? 'nav:playing' : undefined }}
            style={{ height: 30, paddingHorizontal: 12, marginRight: 4, backgroundColor: page === key ? tv.fill : 'transparent' }}>
            <TvText size={16.5} weight="medium" color={page === key ? tv.text : tv.muted}>{label}</TvText>
          </TvButton>;
        })}
        {track && <TvButton id="nav:playing" label={`Now playing, ${track.title}`} onPress={() => setNowPlaying(true)} links={{ left: 'nav:library', down: enter }}
          style={{ height: 40, marginLeft: 'auto', paddingLeft: 5, paddingRight: 12, flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderColor: tv.border, borderRadius: 11, backgroundColor: '#111725', maxWidth: 222 }}>
          <TvArtwork uri={track.artworkData} size={30} /><View style={{ maxWidth: 136 }}><TvText size={13.5} weight="semibold" numberOfLines={1}>{track.title}</TvText><TvText size={12} color={tv.muted} numberOfLines={1}>{track.artist}</TvText></View><PlayingMark />
        </TvButton>}
      </View>
    </TvFocusRegion>}
    {nowPlaying && <TvNowPlaying run={run} />}
    {!!message && <View pointerEvents="none" style={[box(270, 482, 420, 38), { borderRadius: 8, backgroundColor: '#20283b', alignItems: 'center', justifyContent: 'center' }]}><TvText numberOfLines={2}>{message}</TvText></View>}
    {menu && <TvPanel menu={menu} close={closeMenu} />}
  </>;
}

function PlayingMark() {
  const playing = usePlayerStore(s => s.playbackState === 'playing');
  return <Ionicons name={playing ? 'stats-chart' : 'pause'} size={13} color={tv.accent} />;
}
