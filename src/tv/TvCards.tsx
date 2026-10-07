import { useTvTheme } from './useTvTheme';
import { useEffect, useState, type ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import Animated, { useAnimatedStyle, useReducedMotion, withTiming } from 'react-native-reanimated';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import { artworkUri, trackArtworkThumbSource } from '@/library/artwork';
import type { Artist } from '@/types/library';
import type { PlaylistTrackEntry } from '@/types/playlist';
import { usePlaylistStore } from '@/stores/playlistStore';
import { TvButton, useTvFocus } from './TvFocus';
import { box, TvArtwork, TvText } from './TvPrimitives';
import type { TvPlaylist } from './tvCollections';

export function TvCard({ id, title, subtitle, art, left, top, links, enter, open }: {
  id: string; title: string; subtitle: string; art: ReactNode; left: number; top: number;
  links: Parameters<typeof TvButton>[0]['links']; enter: () => void; open: () => void;
}) {
  const tv = useTvTheme();
  const { focused } = useTvFocus();
  const active = focused === id;
  const reduced = useReducedMotion();
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: withTiming(active && !reduced ? 1.03 : 1, { duration: reduced ? 0 : 140 }) }] }));
  return <View style={box(left, top, 127, 174)}>
    <Animated.View style={animated}><TvButton id={id} label={`${title}, ${subtitle}`} links={links} onFocus={enter} onPress={open}
      style={{ width: 127, height: 127, borderRadius: 6 }} ringStyle={{ top: -5, bottom: -5, left: -5, right: -5, borderRadius: 10 }}>{art}</TvButton></Animated.View>
    <TvText weight="medium" color={active ? tv.strong : tv.caption} numberOfLines={1} style={{ marginTop: 9 }}>{title}</TvText>
    <TvText size={11} color={tv.muted} numberOfLines={1} style={{ marginTop: 2 }}>{subtitle}</TvText>
  </View>;
}

function Mosaic({ uris, size, icon = 'musical-notes' }: { uris: string[]; size: number; icon?: 'musical-notes' | 'person' | 'heart' }) {
  const tv = useTvTheme();
  const tiles = uris.length >= 4 ? uris.slice(0, 4) : uris.slice(0, 1);
  return <View style={{ width: size, height: size, borderRadius: 6, overflow: 'hidden', backgroundColor: icon === 'heart' ? '#273f72' : tv.surface, alignItems: 'center', alignContent: 'center', justifyContent: 'center', flexDirection: 'row', flexWrap: 'wrap' }}>
    {icon === 'heart' && <Svg width={size} height={size} style={StyleSheet.absoluteFill}><Defs><LinearGradient id="heart" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#304e87" /><Stop offset="1" stopColor="#292143" /></LinearGradient></Defs><Rect width={size} height={size} fill="url(#heart)" /></Svg>}
    {tiles.length ? tiles.map((uri, i) => <Image key={`${uri}:${i}`} source={{ uri }} recyclingKey={uri} contentFit="cover" cachePolicy="memory-disk"
      style={{ width: tiles.length === 4 ? size / 2 : size, height: tiles.length === 4 ? size / 2 : size }} />) : <Ionicons name={icon} size={size * .32} color={icon === 'heart' ? tv.accent : tv.faint} />}
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: 6, borderWidth: 1, borderStyle: !tiles.length && icon === 'musical-notes' ? 'dashed' : 'solid', borderColor: 'rgba(255,255,255,.08)' }]} />
  </View>;
}

export function TvArtistArt({ artist, size }: { artist: Artist; size: number }) {
  if (artist.artwork_hash && (artist.artwork_source === 'manual' || artist.artwork_source === 'deezer')) return <TvArtwork size={size} uri={artworkUri(artist.artwork_hash)} />;
  return <Mosaic size={size} uris={artist.artwork_hashes.map(artworkUri)} icon="person" />;
}

export function TvPlaylistArt({ playlist, size }: { playlist: TvPlaylist; size: number }) {
  const playlists = usePlaylistStore(s => s.playlists);
  const id = playlist === 'favorites' ? null : playlist.id;
  const version = id == null ? 0 : playlists.find(p => p.id === id)?.updated_at;
  const [covers, setCovers] = useState<{ id: number; uris: string[] } | null>(null);
  useEffect(() => {
    if (id == null) return;
    let cancelled = false;
    void AstraLibraryData.getPlaylistEntries<PlaylistTrackEntry>(id, 0, 20).then(page => {
      const uris = [...new Set(page.items.flatMap(e => { const uri = e.track && trackArtworkThumbSource(e.track); return uri ? [uri] : []; }))].slice(0, 4);
      if (!cancelled) setCovers({ id, uris });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [id, version]);
  return <Mosaic size={size} uris={covers?.id === id ? covers.uris : []} icon={id == null ? 'heart' : 'musical-notes'} />;
}
