import { useEffect, useState } from 'react';
import { BackHandler, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSettingsStore } from '@/stores/settingsStore';
import { useThemeStore } from '@/stores/themeStore';
import { ACCENTS, ACCENT_IDS } from '@/theme/accents';
import { TvBackProvider, useTvBack } from './TvBack';
import { TvFocusProvider } from './TvFocus';
import { TvSetupPage } from './TvSetupPage';
import { TvSourceSetup } from './TvSourceSetup';
import { box, TvFrame, TvText } from './TvPrimitives';
import { useTvTheme } from './useTvTheme';

export function TvOnboarding({ onDone }: { onDone: () => Promise<void> }) {
  return <TvFocusProvider><TvBackProvider><TvFrame><Onboarding onDone={onDone} /></TvFrame></TvBackProvider></TvFocusProvider>;
}

function Onboarding({ onDone }: { onDone: () => Promise<void> }) {
  const tv = useTvTheme(); const { handle } = useTvBack(); const settings = useSettingsStore(); const theme = useThemeStore();
  const [step, setStep] = useState<'welcome' | 'music' | 'portraits' | 'appearance' | 'themes' | 'accents'>('welcome');
  const [entry, setEntry] = useState<string | undefined>(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const go = (next: typeof step, focus?: string) => { setError(''); setEntry(focus); setStep(next); };
  const back = () => {
    if (busy) return true;
    if (step === 'welcome') return false;
    if (step === 'themes' || step === 'accents') go('appearance', step);
    else go(step === 'appearance' ? 'portraits' : step === 'portraits' ? 'music' : 'welcome');
    return true;
  };
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => handle() || back());
    return () => listener.remove();
  });
  const change = (fn: () => Promise<void>) => { setError(''); void fn().catch(reason => setError(reason instanceof Error ? reason.message : 'Could not save this choice.')); };
  if (step === 'music') return <TvSourceSetup close={() => go('welcome')} next={() => go('portraits')} />;
  if (step === 'welcome') return <TvSetupPage title={'Your music.\nYour space.'} description="Bring your collection to the big screen. Let’s make Astra yours." choices={[
    { id: 'begin', label: 'Get started', sub: 'Add your music and make yourself at home', icon: 'arrow-forward-outline', run: () => go('music') },
  ]} />;
  if (step === 'portraits') return <TvSetupPage title="Artist portraits" description="Astra can look up artist photos on Deezer and keep them on this TV for offline use. Only the artist name is sent."
    eyebrow="MAKE IT YOURS" initial={settings.artistImageAutoPolicy} back={back} message={error || 'Optional. You can change this in Settings › Library.'}
    choices={([
      ['wifi', 'Wi-Fi or Ethernet', 'Never uses mobile data'], ['any', 'Any network', 'Includes mobile data'], ['off', 'Off', 'Nothing is sent; use album art'],
    ] as const).map(([id, label, sub]) => ({ id, label, sub, selected: settings.artistImageAutoPolicy === id, run: () => change(() => settings.setArtistImageAutoPolicy(id)) }))}
    next={{ label: 'Continue', run: () => go('appearance') }} />;
  const themes = [{ id: 'midnight', label: 'Midnight' }, { id: 'dark', label: 'Dark' }, { id: 'amoled', label: 'AMOLED' }, { id: 'light', label: 'Light' }] as const;
  if (step === 'themes' || step === 'accents') return <TvSetupPage key={step} title={step === 'themes' ? 'Choose a theme' : 'Choose an accent'} description="See your choice here as you change it." eyebrow="APPEARANCE" back={back}
    choices={step === 'themes' ? themes.map(item => ({ id: item.id, label: item.label, selected: theme.baseTheme === item.id, run: () => change(() => theme.setBaseTheme(item.id)) }))
      : ACCENT_IDS.map(id => ({ id, label: ACCENTS[id].label, selected: theme.accentPreference.kind === 'preset' && theme.accentPreference.id === id, run: () => change(() => theme.setAccent(id)) }))}
    message={error} next={{ label: 'Done', run: back }} />;
  return <TvSetupPage key="appearance" title="Make it yours" description="Choose a theme and accent. You can always change them later in Settings." eyebrow="APPEARANCE" initial={entry} back={back} message={error}
    choices={[
      { id: 'themes', label: 'Theme', value: themes.find(item => item.id === theme.baseTheme)?.label ?? 'System', icon: 'contrast-outline', run: () => go('themes') },
      { id: 'accents', label: 'Accent color', value: theme.accentPreference.kind === 'preset' ? ACCENTS[theme.accentPreference.id].label : 'Custom', icon: 'color-palette-outline', run: () => go('accents') },
    ]}
    preview={<View style={[box(64, 355, 290, 66), { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12, borderRadius: 10, backgroundColor: tv.fill }]}>
      <Ionicons name="musical-notes" size={28} color={tv.accent} /><View><TvText size={15} weight="medium">Your collection</TvText><TvText color={tv.muted}>At home on your TV</TvText></View>
    </View>}
    next={{ label: busy ? 'Finishing…' : 'Start listening', disabled: busy, run: () => { if (busy) return; setBusy(true); void onDone().catch(reason => { setError(String(reason)); setBusy(false); }); } }} />;
}
