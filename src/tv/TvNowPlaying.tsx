import { useThemeStore } from '@/stores/themeStore';
import { useTvTheme } from './useTvTheme';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePlayerStore } from '@/stores/playerStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerUiStore } from '@/stores/playerUiStore';
import { cycleRepeat, skipToNext, skipToPrevious, togglePlay, toggleShuffle } from '@/audio/playbackController';
import { WaveformSeekBar } from '@/components/WaveformSeekBar';
import { playerBackdropArtworkSource } from '@/library/artwork';
import { TvAtmosphere } from './TvAtmosphere';
import { TvButton, useTvFocus } from './TvFocus';
import { box, TvArtwork, TvText } from './TvPrimitives';

/** Stage one transport. Lyrics, queue, seeking and the idle presentation are
 * deliberately deferred together; no touch player is mounted underneath. */
export function TvNowPlaying({ run }: { run: (operation: () => Promise<void>) => void }) {
  const tv = useTvTheme();
  const artworkAccent = useThemeStore(s => s.nowPlayingAccentSource === 'cover-art');
  const { request } = useTvFocus();
  const [titleLines, setTitleLines] = useState(1);
  const track = usePlayerStore(s => s.currentTrack);
  const playing = usePlayerStore(s => s.playbackState === 'playing');
  const shuffle = usePlayerStore(s => s.shuffle);
  const repeat = usePlayerStore(s => s.repeat);
  const favorite = usePlaylistStore(s => !!track && s.favoritePaths.has(track.path));
  useEffect(() => { usePlayerUiStore.getState().settleOpen(); request('np:play'); }, [request]);
  if (!track) return null;
  const controls: { id: string; label: string; icon: keyof typeof Ionicons.glyphMap; run: () => Promise<void>; active?: boolean }[] = [
    { id: 'previous', label: 'Previous track', icon: 'play-skip-back', run: skipToPrevious },
    { id: 'next', label: 'Next track', icon: 'play-skip-forward', run: skipToNext },
    { id: 'shuffle', label: `Shuffle ${shuffle ? 'on' : 'off'}`, icon: 'shuffle', run: toggleShuffle, active: shuffle },
    { id: 'repeat', label: `Repeat ${repeat}`, icon: 'repeat', run: cycleRepeat, active: repeat !== 'none' },
  ];
  return <View style={{ flex: 1, backgroundColor: tv.bg }}>
    <TvAtmosphere uri={artworkAccent ? playerBackdropArtworkSource(track) : null} strength={.9} />
    <TvArtwork uri={track.artworkData} size={220} style={[box(51, 156, 220, 220), { borderRadius: 12 }]} />
    <TvText size={46} weight="semibold" numberOfLines={2} onTextLayout={event => setTitleLines(Math.min(2, event.nativeEvent.lines.length))}
      style={[box(295, 338 - titleLines * 52, 548), { lineHeight: 52 }]}>{track.title}</TvText>
    <TvText size={19} color={tv.muted} numberOfLines={1} style={box(295, 350, 548)}>{track.artist} · {track.album}</TvText>
    <TvButton id="np:favorite" label={favorite ? 'Remove from Favorites' : 'Add to Favorites'} links={{ down: 'np:play' }}
      onPress={() => run(() => usePlaylistStore.getState().toggleFavorite(track))} style={[box(871, 338, 38, 38), { borderRadius: 19, alignItems: 'center', backgroundColor: tv.fill }]}>
      <Ionicons name={favorite ? 'heart' : 'heart-outline'} size={18} color={favorite ? tv.accent : tv.text} />
    </TvButton>
    <TvButton id="np:play" label={playing ? 'Pause' : 'Play'} links={{ up: 'np:favorite', down: 'np:previous' }}
      onPress={() => run(togglePlay)} style={[box(51, 398, 52, 52), { backgroundColor: tv.strong, borderRadius: 26, alignItems: 'center' }]} ringStyle={{ borderRadius: 30 }}>
      <Ionicons name={playing ? 'pause' : 'play'} size={23} color={tv.bg} />
    </TvButton>
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={box(123, 402, 786, 52)}>
      <WaveformSeekBar trackPath={track.path} height={28} touchPadding={0} timesGap={8} timesHeight={16} onSeek={() => {}} />
    </View>
    {controls.map((control, i) => <TvButton key={control.id} id={`np:${control.id}`} label={control.label}
      links={{ up: 'np:play', left: i ? `np:${controls[i - 1].id}` : undefined, right: i < controls.length - 1 ? `np:${controls[i + 1].id}` : undefined }}
      onPress={() => run(control.run)} style={[box(51 + i * 48, 470, 38, 38), { backgroundColor: control.active ? tv.fill : tv.hover, borderRadius: 19, alignItems: 'center' }]} ringStyle={{ borderRadius: 23 }}>
      <Ionicons name={control.icon} size={18} color={control.active ? tv.accent : tv.text} />
      {control.id === 'repeat' && repeat === 'one' && <TvText size={8} style={{ position: 'absolute', right: 6, top: 3 }}>1</TvText>}
    </TvButton>)}
    {['Lyrics', 'Queue', 'More'].map((label, i) => <TvButton key={label} id={`np:${label}`} label={label} disabled onPress={() => {}}
      style={[box(630 + i * 96, 470, 88, 36), { borderRadius: 18, backgroundColor: tv.fill, alignItems: 'center' }]}><TvText>{label}</TvText></TvButton>)}
  </View>;
}
