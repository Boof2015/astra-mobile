import { useEffect, useRef, useState } from 'react';
import { findNodeHandle, Keyboard, TextInput, View } from 'react-native';
import { showTvKeyboard } from '../../modules/astra-tv';
import { fonts } from '@/theme/typography';
import { TvButton, useTvFocus } from './TvFocus';
import { box, tv, TvText } from './TvPrimitives';

export function TvNameFlow({ initial, submit, cancel }: { initial?: string; submit: (name: string) => Promise<void>; cancel: () => void }) {
  const { request, activate } = useTvFocus(); const input = useRef<TextInput>(null); const mounted = useRef(true);
  const [name, setName] = useState(initial ?? ''); const nameRef = useRef(name);
  const [keyboard, setKeyboard] = useState(Keyboard.isVisible()); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submitting = useRef(false);
  const verb = initial === undefined ? 'Create' : 'Save';
  useEffect(() => {
    mounted.current = true;
    const frame = requestAnimationFrame(() => input.current?.focus());
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      input.current?.blur(); setKeyboard(false); request(nameRef.current.trim() ? 'name:submit' : 'name:cancel');
    });
    return () => { mounted.current = false; cancelAnimationFrame(frame); shown.remove(); hidden.remove(); };
  }, [request]);
  const save = async () => {
    if (submitting.current) return;
    if (!name.trim()) { setError('Give it a name first'); input.current?.focus(); return; }
    submitting.current = true; setBusy(true); setError('');
    try { await submit(name.trim()); }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not save the playlist.'); }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  };
  return <View style={{ flex: 1, backgroundColor: tv.bg }}>
    <TvText mono size={10.5} color={tv.accent} style={[box(200, 112, 560), { letterSpacing: 1.6 }]}>{initial === undefined ? 'NEW PLAYLIST' : 'RENAME PLAYLIST'}</TvText>
    <TvText size={30} weight="semibold" style={box(200, 140, 560)}>Name your playlist</TvText>
    <TvText color={tv.muted} style={box(200, 188, 560)}>Choose a name for this collection.</TvText>
    <TvButton id="name:field" label="Playlist name" links={{ down: name.trim() ? 'name:submit' : 'name:cancel' }} onPress={() => { input.current?.focus(); void showTvKeyboard(findNodeHandle(input.current)).catch(() => {}); }} style={[box(200, 224, 560, 52), { borderRadius: 12, backgroundColor: tv.fill, paddingHorizontal: 16 }]}>
      <TextInput ref={input} value={name} onChangeText={value => { nameRef.current = value; setName(value); setError(''); }}
        onFocus={() => { activate('name:field'); void showTvKeyboard(findNodeHandle(input.current)).catch(() => {}); }}
        accessibilityLabel="Playlist name" placeholder="Playlist name" placeholderTextColor={tv.faint} returnKeyType="done" returnKeyLabel={verb} submitBehavior="submit"
        onSubmitEditing={() => void save()} autoCorrect={false} selectTextOnFocus={initial !== undefined} maxLength={200}
        style={{ color: tv.text, fontFamily: fonts.sans.regular, fontSize: 19, padding: 0 }} />
    </TvButton>
    {!!error && <TvText color="#ffb4b4" style={box(200, 288, 560)}>{error}</TvText>}
    {!keyboard && <View style={box(200, 332, 560, 38)}>
      <TvButton id="name:submit" label={verb} disabled={!name.trim() || busy} onPress={() => void save()} links={{ up: 'name:field', right: 'name:cancel' }} style={[box(0, 0, 124, 38), { backgroundColor: tv.fill, alignItems: 'center' }]}><TvText color={tv.accent}>{busy ? 'Saving…' : verb}</TvText></TvButton>
      <TvButton id="name:cancel" label="Cancel" onPress={cancel} links={{ up: 'name:field', left: name.trim() && !busy ? 'name:submit' : undefined }} style={[box(140, 0, 124, 38), { backgroundColor: tv.fill, alignItems: 'center' }]}><TvText>Cancel</TvText></TvButton>
    </View>}
  </View>;
}
