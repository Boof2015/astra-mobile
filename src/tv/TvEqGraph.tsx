import { useTvTheme } from './useTvTheme';
import { memo, useMemo } from 'react';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import type { EQBand } from '@/types/audio';
import { computeEQFilterMagnitude, isPassEQBandType } from '@/audio/eq';
import { bandColor, useBandPalette } from '@/components/eq/bandColors';
import { formatFreqHz, formatGain } from '@/components/eq/format';
import { fonts } from '@/theme/typography';

const width = 858;
const xAt = (frequency: number) => Math.log10(frequency / 20) / 3 * width;
const ticks: [number, string][] = [[50, '50'], [100, '100'], [200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']];

/** Same biquad response as the audio engine and phone graph, at its 48 kHz
 * display rate. Preamp is separate, as in the approved reference. */
export const TvEqGraph = memo(function TvEqGraph({ bands, height, selected, grabbed, graphic = false }: {
  bands: EQBand[]; height: number; selected: string | null; grabbed: boolean; graphic?: boolean;
}) {
  const tv = useTvTheme(); const palette = useBandPalette();
  const yAt = (gain: number) => Math.max(4, Math.min(height - 4, height / 2 - gain * (height / 2 - 14) / 12));
  const paths = useMemo(() => {
    const points = Array.from({ length: 161 }, (_, i) => ({ x: i / 160 * width, f: 20 * 1000 ** (i / 160) }));
    const rows = bands.map(band => points.map(point => band.enabled ? computeEQFilterMagnitude(band, point.f, 48000) : 0));
    const y = (gain: number) => Math.max(4, Math.min(height - 4, height / 2 - gain * (height / 2 - 14) / 12));
    const line = (values: number[]) => points.map((point, i) => `${i ? 'L' : 'M'}${point.x.toFixed(1)} ${y(values[i]).toFixed(1)}`).join(' ');
    return { bands: rows.map(row => `M0 ${height / 2} ${line(row).replace(/^M/, 'L')} L${width} ${height / 2} Z`),
      total: line(points.map((_, i) => rows.reduce((sum, row) => sum + row[i], 0))) };
  }, [bands, height]);
  return <Svg width={width} height={height} style={{ overflow: 'visible' }}>
    {[12, 6, 0, -6, -12].map(gain => <G key={gain}>
      <Line x1={0} x2={width} y1={yAt(gain)} y2={yAt(gain)} stroke={`rgba(124,146,196,${gain === 0 ? .32 : .12})`} />
      <SvgText x={4} y={yAt(gain) - 4} fill={tv.faint} fontFamily={fonts.mono.regular} fontSize={9.5}>{gain > 0 ? '+' : ''}{gain}</SvgText>
    </G>)}
    {ticks.map(([frequency, label]) => <G key={frequency}>
      <Line x1={xAt(frequency)} x2={xAt(frequency)} y1={0} y2={height} stroke="rgba(124,146,196,.08)" />
      <SvgText x={xAt(frequency) + 4} y={height - 6} fill={tv.faint} fontFamily={fonts.mono.regular} fontSize={9.5}>{label}</SvgText>
    </G>)}
    {bands.map((band, i) => band.enabled && <Path key={band.id} d={paths.bands[i]} fill={bandColor(palette, band)}
      fillOpacity={band.id === selected ? .26 : selected ? .06 : .12} stroke={bandColor(palette, band)} strokeOpacity={band.id === selected ? .95 : .4} strokeWidth={band.id === selected ? 1.6 : 1} />)}
    <Path d={paths.total} fill="none" stroke={tv.strong} strokeWidth={2.4} strokeLinejoin="round" />
    {bands.map((band, i) => {
      const color = bandColor(palette, band); const on = band.id === selected;
      const x = xAt(band.frequency); const y = yAt(isPassEQBandType(band.type) ? computeEQFilterMagnitude(band, band.frequency, 48000) : band.gain);
      const label = `${formatFreqHz(band.frequency)} · ${formatGain(band.gain)} dB${graphic ? '' : ` · Q ${band.Q.toFixed(2)}`}`;
      const labelWidth = label.length * 6.7 + 16;
      const lx = Math.max(8, Math.min(x + 14, width - labelWidth + 8)); const ly = Math.max(y - 14, 18);
      return <G key={band.id}>
        {on && grabbed && <G>
          <Line x1={x} x2={x} y1={0} y2={height} stroke={color} strokeOpacity={.6} strokeDasharray="3 4" />
          <Line x1={0} x2={width} y1={y} y2={y} stroke={color} strokeOpacity={.6} strokeDasharray="3 4" />
          <Rect x={lx - 8} y={ly - 15} width={labelWidth} height={22} rx={6} fill={tv.panel} stroke={color} strokeOpacity={.7} />
          <SvgText x={lx} y={ly} fill={tv.strong} fontFamily={fonts.mono.regular} fontSize={11.5}>{label}</SvgText>
        </G>}
        {on && <Circle cx={x} cy={y} r={13} fill="none" stroke={tv.focus} strokeWidth={2} />}
        <Circle cx={x} cy={y} r={on ? 9 : 7} fill={color} fillOpacity={band.enabled ? 1 : .35} />
        <SvgText x={x} y={y + 3.5} textAnchor="middle" fill={palette.ink} fontFamily={fonts.sans.bold} fontSize={on ? 10 : 9}>{i + 1}</SvgText>
      </G>;
    })}
  </Svg>;
});
