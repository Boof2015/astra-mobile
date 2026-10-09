import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TvWordmark } from './TvWordmark';
import { TvAtmosphere } from './TvAtmosphere';
import { TvButton, useTvFocus } from './TvFocus';
import { box, TvText, TvViewport } from './TvPrimitives';
import { useTvTheme } from './useTvTheme';

export type SetupChoice = { id: string; label: string; sub?: string; value?: string; selected?: boolean; disabled?: boolean;
  icon?: ComponentProps<typeof Ionicons>['name']; run: () => void };

/** One vertical path, with a persistent footer reachable directly to the right. */
export function TvSetupPage({ eyebrow = 'SET UP ASTRA', title, description, choices, next, back, initial, message, preview, busy = false }: {
  eyebrow?: string; title: string; description: string; choices: SetupChoice[]; next?: { label: string; run: () => void; disabled?: boolean };
  back?: () => void; initial?: string; message?: string; preview?: ReactNode; busy?: boolean;
}) {
  const tv = useTvTheme(); const { focused, request } = useTvFocus(); const [remembered, setRemembered] = useState(initial ?? choices[0]?.id ?? '');
  const enabled = choices.filter(row => !row.disabled); const index = Math.max(0, choices.findIndex(row => row.id === remembered));
  const start = Math.max(0, Math.min(index - 3, choices.length - 5));
  const footer = next && !next.disabled ? 'setup:next' : back ? 'setup:back' : undefined;
  const [firstFocus] = useState(() => enabled[0] ? `setup:${enabled[0].id}` : footer ?? 'setup:back');
  useEffect(() => { request(initial ? `setup:${initial}` : firstFocus); }, [initial, firstFocus, request]);
  return <View style={[box(0, 0, 960, 540), { backgroundColor: tv.bg }]}>
    <TvAtmosphere uri={null} strength={.35} />
    <View style={[box(64, 53, 240, 28), { justifyContent: 'center' }]}><TvWordmark width={168} /></View>
    <TvText mono size={10} color={tv.accent} style={[box(64, 132, 300), { letterSpacing: 1.8 }]}>{eyebrow}</TvText>
    <TvText size={32} weight="semibold" numberOfLines={2} style={box(64, 160, 300)}>{title}</TvText>
    <TvText size={14} color={tv.muted} numberOfLines={7} style={box(64, 265, 300)}>{description}</TvText>
    {preview}
    <TvViewport width={476} height={302} topFade={0} bottomFade={0} style={box(414, 129, 476, 302)}>
      {choices.map((row, i) => {
        const at = enabled.indexOf(row); const hot = focused === `setup:${row.id}`;
        return <TvButton key={row.id} id={`setup:${row.id}`} disabled={row.disabled}
          label={`${row.label}${row.selected !== undefined ? row.selected ? ', selected' : ', not selected' : ''}${row.value ? `, ${row.value}` : ''}`}
          onPress={() => { if (!busy) row.run(); }} onFocus={() => setRemembered(row.id)}
          links={{ up: at > 0 ? `setup:${enabled[at - 1].id}` : undefined, down: at + 1 < enabled.length ? `setup:${enabled[at + 1].id}` : footer, right: footer }}
          style={[box(7, 7 + (i - start) * 58, 462, 52), { paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: row.selected ? tv.fill : hot ? tv.hover : 'transparent' }]}>
          {row.icon && <Ionicons name={row.icon} size={21} color={row.selected ? tv.accent : tv.muted} />}
          <View style={{ flex: 1 }}><TvText weight="medium" size={15} numberOfLines={1}>{row.label}</TvText>{row.sub && <TvText color={tv.muted} size={11.5} numberOfLines={1} style={{ marginTop: 3 }}>{row.sub}</TvText>}</View>
          {row.value && <TvText color={tv.muted} size={12}>{row.value}</TvText>}
          {row.selected !== undefined && <Ionicons name={row.selected ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={row.selected ? tv.accent : tv.faint} />}
        </TvButton>;
      })}
    </TvViewport>
    {!!message && <TvText size={11.5} color={tv.muted} numberOfLines={2} style={box(421, 435, 462)}>{message}</TvText>}
    {back && <TvButton id="setup:back" label="Back" onPress={back} links={{ up: `setup:${remembered}`, left: `setup:${remembered}`, right: next && !next.disabled ? 'setup:next' : undefined }} style={[box(421, 483, 100, 34), { alignItems: 'center' }]}><TvText color={tv.muted}>Back</TvText></TvButton>}
    {next && <TvButton id="setup:next" label={next.label} disabled={next.disabled} onPress={next.run} links={{ up: `setup:${remembered}`, left: back ? 'setup:back' : `setup:${remembered}` }} style={[box(677, 483, 206, 34), { alignItems: 'center', backgroundColor: tv.fill }]}><TvText color={tv.accent} weight="medium">{next.label}</TvText></TvButton>}
  </View>;
}
