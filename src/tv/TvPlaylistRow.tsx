import { useTvTheme } from './useTvTheme';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, withTiming } from 'react-native-reanimated';
import { trackArtworkThumbSource } from './artwork';
import { formatDuration } from '@/lib/format';
import type { PlaylistTrackEntry } from '@/types/playlist';
import type { FocusLinks } from './focusGeometry';
import { TvButton, useTvFocus } from './TvFocus';
import { box, TvArtwork, TvText } from './TvPrimitives';

/** Stable entry keys and a fixed top let both exchanged rows slide to their new
 * slots. Focus belongs to the row's identity, never to its old numeric slot. */
export function TvPlaylistRow({ entry, id, optionsId, index, playing, editing, grabbed, locked, links, optionLinks, enter, press, options, move }: {
  entry: PlaylistTrackEntry; id: string; optionsId: string; index: number; playing: boolean;
  editing: boolean; grabbed: boolean; locked: boolean; links: FocusLinks; optionLinks: FocusLinks;
  enter: (options?: boolean) => void; press: () => void; options: () => void; move: (direction: -1 | 1) => void;
}) {
  const tv = useTvTheme();
  const { focused } = useTvFocus();
  const hot = focused === id || focused === optionsId;
  const reduced = useReducedMotion();
  const animated = useAnimatedStyle(() => ({
    transform: [{ translateY: withTiming(index * 52, { duration: reduced ? 0 : 220, easing: Easing.out(Easing.cubic) }) }],
    backgroundColor: withTiming(grabbed ? 'rgba(124,146,196,.2)' : hot ? 'rgba(124,146,196,.09)' : 'rgba(124,146,196,0)', { duration: reduced ? 0 : 140 }),
  }));
  const title = entry.track?.title ?? entry.fallback_title ?? 'Unavailable track';
  const artist = entry.track?.artist ?? entry.fallback_artist ?? 'Unavailable';
  return <Animated.View style={[box(8, 8, 602, 49), { borderRadius: 8, zIndex: grabbed ? 2 : 0, boxShadow: grabbed ? '0px 16px 34px rgba(0,0,0,.55)' : undefined }, animated]}>
    <TvButton id={id} label={`${entry.track ? '' : 'Unavailable, '}${title}, ${artist}${grabbed ? ', moving' : ''}`} onFocus={() => enter(false)} onPress={press}
      links={editing || locked ? {} : { ...links, right: optionsId }}
      onVertical={editing ? direction => move(direction === 'up' ? -1 : 1) : undefined}
      style={{ height: 49, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <TvText mono size={grabbed ? 17 : 11} color={grabbed || playing ? tv.accent : tv.faint} style={{ width: 22, textAlign: 'center' }}>{grabbed ? '⇅' : playing ? '▶' : index + 1}</TvText>
      <TvArtwork uri={entry.track ? trackArtworkThumbSource(entry.track) : null} size={34} />
      <View style={{ flex: 1 }}><TvText numberOfLines={1} weight="medium" color={entry.track ? playing ? tv.accent : hot ? tv.strong : tv.caption : tv.muted}>{title}</TvText>
        <TvText size={11} numberOfLines={1} color={tv.muted}>{entry.track ? artist : `${artist} · Unavailable`}</TvText></View>
      <TvText mono size={11} color={tv.muted} style={{ width: 46, textAlign: 'right', marginRight: 43 }}>{entry.track ? formatDuration(entry.track.duration) : '—'}</TvText>
    </TvButton>
    {grabbed && <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 4, bottom: 4, width: 3, borderRadius: 2, backgroundColor: tv.accent }} />}
    <TvButton id={optionsId} label={`Options for ${title}`} disabled={editing} links={{ ...optionLinks, left: id }} onFocus={() => enter(true)} onPress={options}
      style={{ position: 'absolute', right: 7, top: 9, width: 28, height: 30, alignItems: 'center', opacity: editing ? 0 : 1 }}>
      <TvText size={18} color={focused === optionsId ? tv.strong : tv.muted} style={{ opacity: hot && !editing ? 1 : 0 }}>···</TvText>
    </TvButton>
  </Animated.View>;
}
