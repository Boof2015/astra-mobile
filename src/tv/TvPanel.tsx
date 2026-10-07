import { useEffect } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { TvButton, useTvFocus } from './TvFocus';
import { box, tv, TvText } from './TvPrimitives';

export type TvMenuItem = { label: string; selected?: boolean; run: () => void };
export type TvMenu = { title: string; items: TvMenuItem[]; opener: string; left: number; top: number; selected?: number };

/** Background content is unmounted from the focus registry by the caller while
 * this panel is open. Every edge here is explicit and stays inside the panel. */
export function TvPanel({ menu, close }: { menu: TvMenu; close: () => void }) {
  const { request } = useTvFocus();
  useEffect(() => { request(`menu:${menu.selected ?? 0}`); }, [menu, request]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => subscription.remove();
  }, [close]);
  return <View style={StyleSheet.absoluteFill}>
    <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(4,6,10,.38)' }]} />
    <View style={[box(menu.left, Math.min(menu.top, 513 - (58 + menu.items.length * 38)), 250), { backgroundColor: '#101522', padding: 10, paddingTop: 16, borderRadius: 14, borderWidth: 1, borderColor: tv.border }]}>
      <TvText size={15} weight="semibold" numberOfLines={1} style={{ marginHorizontal: 6, marginBottom: 12 }}>{menu.title}</TvText>
      {menu.items.map((item, index) => <TvButton key={item.label} id={`menu:${index}`} label={item.label}
        links={{ up: `menu:${Math.max(0, index - 1)}`, down: `menu:${Math.min(menu.items.length - 1, index + 1)}` }}
        style={{ height: 38, paddingHorizontal: 10 }} onPress={() => { close(); item.run(); }}>
        <TvText color={item.selected ? tv.accent : tv.text}>{item.selected ? '✓  ' : ''}{item.label}</TvText>
      </TvButton>)}
    </View>
  </View>;
}
