import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TvButton, useTvFocus } from './TvFocus';
import { box, TvText, TvViewport } from './TvPrimitives';
import { useTvTheme } from './useTvTheme';
import { settingsWindow } from './settingsModel';
import type { TvDirection } from '../../modules/astra-tv';

type BaseRow = { id: string; label: string; sub?: string; disabled?: boolean; value?: string };
export type SettingsRow = BaseRow & (
  | { kind: 'toggle'; on: boolean; run: () => void }
  | { kind: 'choice'; choices: { label: string; run: () => void; selected?: boolean; swatch?: string }[] }
  | { kind: 'value'; amount: number; min: number; max: number; set: (value: number) => void }
  | { kind: 'action' | 'link'; run: () => void }
);
export const settingsRowId = (page: string, id: string) => `settings:row:${page}:${id}`;

export function TvSettingsRows({ rows, page, remembered, left, up, grab, enter, press, adjust }: {
  rows: SettingsRow[]; page: string; remembered?: string; left: string; up: string; grab: string | null;
  enter: (id: string) => void; press: (row: SettingsRow, center: number) => void; adjust: (row: SettingsRow, direction: TvDirection) => void;
}) {
  const tv = useTvTheme(); const { focused } = useTvFocus();
  const index = Math.max(0, rows.findIndex(row => row.id === remembered));
  const start = settingsWindow(index, rows.length); const enabled = rows.filter(row => !row.disabled);
  return <TvViewport width={660} height={356} topFade={0} bottomFade={0} style={box(256, 143, 660, 356)}>
    {rows.map((row, i) => {
      const id = settingsRowId(page, row.id); const held = grab === id; const hot = focused === id; const at = enabled.indexOf(row);
      const width = held ? 170 : 120;
      return <TvButton key={row.id} id={id} label={`${row.label}${row.kind === 'toggle' ? `, ${row.on ? 'on' : 'off'}` : row.value ? `, ${row.value}` : ''}`}
        disabled={row.disabled} onFocus={() => enter(row.id)} onPress={() => press(row, 177 + (i - start) * 58)} onDirection={held ? direction => adjust(row, direction) : undefined}
        links={{ left, up: at > 0 ? settingsRowId(page, enabled[at - 1].id) : up, down: at + 1 < enabled.length ? settingsRowId(page, enabled[at + 1].id) : undefined }}
        style={[box(7, 7 + (i - start) * 58, 646, 54), { borderRadius: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: held ? tv.fill : hot ? tv.hover : 'transparent' }]} ringStyle={{ borderRadius: 13 }}>
        <View style={{ flex: 1, minWidth: 0 }}><TvText size={14} weight="medium" color={hot ? tv.strong : tv.caption} numberOfLines={1}>{row.label}</TvText>
          {(held || row.sub) && <TvText size={11.5} color={tv.muted} numberOfLines={1} style={{ marginTop: 3 }}>{held ? '◀ ▶ to adjust · OK or Back when done' : row.sub}</TvText>}</View>
        {row.kind === 'toggle' ? <View style={{ width: 36, height: 20, borderRadius: 10, backgroundColor: row.on ? tv.fill : tv.border, padding: 3, alignItems: row.on ? 'flex-end' : 'flex-start' }}>
          <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: row.on ? tv.accentStrong : tv.muted }} />
        </View> : <>
          {row.kind === 'value' && <View style={{ width, height: 14 }}>
            <View style={[box(0, 6, width, 3), { borderRadius: 2, backgroundColor: tv.border }]} />
            <View style={[box(0, 6, width * (row.amount - row.min) / (row.max - row.min), 3), { borderRadius: 2, backgroundColor: held ? tv.accentStrong : tv.accent }]} />
            <View style={[box(width * (row.amount - row.min) / (row.max - row.min) - (held ? 7 : 5), held ? 0 : 2, held ? 14 : 10, held ? 14 : 10), { borderRadius: 7, backgroundColor: held ? tv.strong : tv.accentStrong }]} />
          </View>}
          {!!row.value && <TvText mono={row.kind === 'value'} size={row.kind === 'value' ? 12.5 : 13} color={hot ? tv.text : tv.muted} numberOfLines={1} style={{ maxWidth: 270 }}>{held ? '◀ ' : ''}{row.value}{held ? ' ▶' : ''}</TvText>}
          {(row.kind === 'link' || row.kind === 'choice') && <Ionicons name="chevron-forward" size={12} color={hot ? tv.muted : tv.faint} style={{ marginLeft: -8 }} />}
        </>}
      </TvButton>;
    })}
  </TvViewport>;
}
