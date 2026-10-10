import { memo, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { usePlayerStore } from '@/stores/playerStore';
import { useAnimatedPlaybackProgress } from '@/audio/useAnimatedPlaybackProgress';
import { downsampleWaveform, getWaveform, normalizeProgressiveWaveform, subscribeWaveformProgress } from '@/scope/waveform';
import { TvText } from './TvPrimitives';
import { playerTime } from './nowPlayingModel';
import { useTvTheme } from './useTvTheme';

// One path per layer avoids hundreds of SVG layout events (and synchronous
// Reanimated flushes) when mounting the player. Time updates reuse the drawing.
const WaveformDrawing = memo(function WaveformDrawing({ width, height, path, color }: { width: number; height: number; path: string; color: string }) {
  return <Svg width={width} height={height}><Path d={path} fill={color} /></Svg>;
});

/** TV shares the decoder/cache and playback clock; only its remote preview is local. */
export function TvPlayerWaveform({ path, width, height, preview, active }: { path: string; width: number; height: number; preview: number | null; active: boolean }) {
  const tv = useTvTheme();
  const time = usePlayerStore(s => s.currentTime);
  const duration = usePlayerStore(s => s.duration);
  const playing = usePlayerStore(s => s.playbackState === 'playing');
  const pending = usePlayerStore(s => s.pendingSeek);
  const progress = useAnimatedPlaybackProgress({ trackKey: path, active, currentTime: time, duration, isPlaying: playing,
    overrideFraction: pending && duration > 0 ? pending.target / duration : null });
  const played = useAnimatedStyle(() => ({ width: Math.max(0, Math.min(1, progress.value)) * width }));
  const [data, setData] = useState<{ path: string; peaks: Float32Array; complete: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const stop = subscribeWaveformProgress(path, ({ peaks, totalBins }) => {
      if (!cancelled) setData(current => current?.path === path && current.complete ? current : { path, peaks: normalizeProgressiveWaveform(peaks, totalBins), complete: false });
    });
    void getWaveform(path).then(peaks => { if (!cancelled && peaks) setData({ path, peaks, complete: true }); });
    return () => { cancelled = true; stop(); };
  }, [path]);
  const count = width > 400 ? 110 : 56;
  const source = data?.path === path ? data.peaks : null;
  const bars = useMemo(() => source ? Array.from(downsampleWaveform(source, count)) : Array<number>(count).fill(0), [source, count]);
  const pathData = useMemo(() => bars.map((value, i) => {
    const h = Math.max(2, height * value); const w = Math.max(1, width / count - 2);
    const x = i * width / count; const y = (height - h) / 2; const r = Math.min(1.2, w / 2, h / 2);
    return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${2 * r - w}a${r} ${r} 0 0 1 ${-r} ${-r}v${2 * r - h}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
  }).join(''), [bars, count, width, height]);
  const x = duration > 0 && preview !== null ? width * preview / duration : 0;
  return <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={{ width, height }}>
    <WaveformDrawing width={width} height={height} path={pathData} color={tv.dark ? 'rgba(238,242,255,.2)' : 'rgba(30,40,60,.2)'} />
    <Animated.View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }, played]}><WaveformDrawing width={width} height={height} path={pathData} color={tv.strong} /></Animated.View>
    <TvText mono size={12} color={tv.muted} style={{ position: 'absolute', left: 0, top: height + 8 }}>{playerTime(time)}</TvText>
    <TvText mono size={12} color={tv.muted} style={{ position: 'absolute', right: 0, top: height + 8 }}>−{playerTime(duration - time)}</TvText>
    {preview !== null && <>
      <View style={{ position: 'absolute', left: Math.max(0, Math.min(width - 2, x)), top: -9, width: 2, height: height + 18, borderRadius: 1, backgroundColor: tv.accent }} />
      <View style={{ position: 'absolute', left: Math.max(0, Math.min(width - 68, x - 34)), top: -40, width: 68, paddingVertical: 4, alignItems: 'center', borderRadius: 7, backgroundColor: tv.panel, borderWidth: 1, borderColor: tv.accent }}>
        <TvText mono size={12}>{playerTime(preview)}</TvText>
      </View>
    </>}
  </View>;
}

export function TvPlayerHairline({ path, active, color }: { path: string; active: boolean; color?: string }) {
  const tv = useTvTheme();
  const time = usePlayerStore(s => s.currentTime);
  const duration = usePlayerStore(s => s.duration);
  const playing = usePlayerStore(s => s.playbackState === 'playing');
  const progress = useAnimatedPlaybackProgress({ trackKey: path, active, currentTime: time, duration, isPlaying: playing });
  const style = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.max(0, Math.min(1, progress.value)) }] }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, bottom: 0, width: 960, height: 2, transformOrigin: 'left', backgroundColor: color ?? tv.strong, opacity: .45 }, style]} />;
}
