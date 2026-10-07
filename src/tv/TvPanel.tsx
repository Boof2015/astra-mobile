import { useEffect, type ComponentProps } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TvButton, useTvFocus } from './TvFocus';
import { box, tv, TvText } from './TvPrimitives';
import { gridNeighbor } from './focusGeometry';

export type TvMenuItem = { label: string; selected?: boolean; disabled?: boolean; muted?: boolean; keepOpen?: boolean; icon?: ComponentProps<typeof Ionicons>['name']; swatch?: string; run: () => void };
export type TvMenu = { title: string; message?: string; items: TvMenuItem[]; opener: string; left: number; top: number; selected?: number; columns?: number };

/** Background content is unmounted from the focus registry by the caller while
 * this panel is open. Every edge here is explicit and stays inside the panel. */
export function TvPanel({ menu, close }: { menu: TvMenu; close: () => void }) {
  const { request, focused } = useTvFocus();
  const items = menu.items.some(item => !item.disabled) ? menu.items : [...menu.items, { label: 'Done', run: () => {} }];
  const enabled = items.flatMap((item, i) => item.disabled ? [] : [i]);
  const initial = enabled.includes(menu.selected ?? 0) ? menu.selected ?? 0 : enabled[0];
  useEffect(() => { request(`menu:${initial}`); }, [menu, initial, request]);
  const index = focused.startsWith('menu:') ? Number(focused.slice(5)) : initial;
  const start = Math.max(0, Math.min(index - 3, items.length - 8));
  const columns = menu.columns;
  const rows = columns ? Math.ceil(items.length / columns) : Math.min(items.length, 8);
  const height = 58 + (menu.message ? 48 : 0) + rows * 38;
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => subscription.remove();
  }, [close]);
  return <View style={StyleSheet.absoluteFill}>
    <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(4,6,10,.38)' }]} />
    <View style={[box(menu.left, Math.max(76, Math.min(menu.top, 513 - height)), columns ? 290 : 250), { backgroundColor: '#101522', padding: 10, paddingTop: 16, borderRadius: 14, borderWidth: 1, borderColor: tv.border }]}>
      <TvText size={15} weight="semibold" numberOfLines={1} style={{ marginHorizontal: 6, marginBottom: 12 }}>{menu.title}</TvText>
      {!!menu.message && <TvText size={11.5} color={tv.muted} numberOfLines={3} style={{ height: 48, marginHorizontal: 6 }}>{menu.message}</TvText>}
      <View style={{ height: rows * 38 + 8, overflow: 'hidden', marginHorizontal: -4, paddingHorizontal: 4 }}>
      {items.map((item, index) => !columns && (index < start - 1 || index > start + 8) ? null : <TvButton key={`${index}:${item.label}`} id={`menu:${index}`} label={item.label} disabled={item.disabled}
        links={columns ? Object.fromEntries((['up', 'down', 'left', 'right'] as const).map(direction => [direction, `menu:${gridNeighbor(index, items.length, columns, direction)}`])) : { up: `menu:${enabled[Math.max(0, enabled.indexOf(index) - 1)]}`, down: `menu:${enabled[Math.min(enabled.length - 1, enabled.indexOf(index) + 1)]}` }}
        style={{ position: 'absolute', ...(columns ? { top: 4 + Math.floor(index / columns) * 38, left: 8 + index % columns * 38, width: 34, height: 34, alignItems: 'center' as const } : { top: 4 + (index - start) * 38, left: 4, right: 4, height: 38, paddingHorizontal: 10 }), backgroundColor: focused === `menu:${index}` ? tv.fill : 'transparent' }} onPress={() => { if (!item.keepOpen) close(); item.run(); }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {item.icon && <Ionicons name={item.icon} size={14} color={tv.muted} />}
          {item.swatch && <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: item.swatch }} />}
          <TvText mono={!!columns} numberOfLines={1} style={!columns ? { flex: 1 } : undefined} size={columns ? 14 : 13} color={focused === `menu:${index}` ? tv.strong : item.muted ? tv.faint : item.selected ? tv.accent : tv.text}>{item.selected ? '✓  ' : ''}{item.label}</TvText>
        </View>
      </TvButton>)}
      </View>
    </View>
  </View>;
}
