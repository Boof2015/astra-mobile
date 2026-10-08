import { useTvTheme } from './useTvTheme';
import { useEffect, useRef, useState } from 'react';
import { findNodeHandle, Keyboard, TextInput, View } from 'react-native';
import { showTvKeyboard } from '../../modules/astra-tv';
import { fonts } from '@/theme/typography';
import { TvButton, useTvFocus } from './TvFocus';
import { box, TvText } from './TvPrimitives';

export function TvNameFlow({ initial, submit, cancel, labels, onChange, cancelLabel = 'Cancel', busyLabel = 'Saving…', allowEmpty = false, secure = false, trim = true, keyboardType = 'default' }: { initial?: string; submit: (name: string) => Promise<void>; cancel: () => void;
  onChange?: (value: string) => void; cancelLabel?: string; busyLabel?: string;
  allowEmpty?: boolean; secure?: boolean; trim?: boolean; keyboardType?: 'default' | 'url'; labels?: { eyebrow: string; title: string; description: string; field: string; verb: string } }) {
  const tv = useTvTheme();
  const { request, activate } = useTvFocus(); const input = useRef<TextInput>(null); const mounted = useRef(true);
  const [name, setName] = useState(initial ?? ''); const nameRef = useRef(name);
  const [keyboard, setKeyboard] = useState(Keyboard.isVisible()); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submitting = useRef(false);
  const verb = labels?.verb ?? (initial === undefined ? 'Create' : 'Save');
  const field = labels?.field ?? 'Playlist name';
  useEffect(() => {
    mounted.current = true;
    const frame = requestAnimationFrame(() => input.current?.focus());
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      input.current?.blur(); setKeyboard(false); request(allowEmpty || nameRef.current.trim() ? 'name:submit' : 'name:cancel');
    });
    return () => { mounted.current = false; cancelAnimationFrame(frame); shown.remove(); hidden.remove(); };
  }, [request, allowEmpty]);
  const save = async () => {
    if (submitting.current) return;
    if (!allowEmpty && !name.trim()) { setError('Give it a name first'); input.current?.focus(); return; }
    submitting.current = true; setBusy(true); setError('');
    try { await submit(trim ? name.trim() : name); }
    catch (reason) { if (mounted.current) { setError(reason instanceof Error ? reason.message : 'Could not save.'); if (!Keyboard.isVisible()) request('name:submit'); } }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  };
  return <View style={{ flex: 1, backgroundColor: tv.bg }}>
    <TvText mono size={10.5} color={tv.accent} style={[box(200, 112, 560), { letterSpacing: 1.6 }]}>{labels?.eyebrow ?? (initial === undefined ? 'NEW PLAYLIST' : 'RENAME PLAYLIST')}</TvText>
    <TvText size={30} weight="semibold" style={box(200, 140, 560)}>{labels?.title ?? 'Name your playlist'}</TvText>
    <TvText color={tv.muted} style={box(200, 188, 560)}>{labels?.description ?? 'Choose a name for this collection.'}</TvText>
    <TvButton id="name:field" label={field} disabled={busy} links={{ down: allowEmpty || name.trim() ? 'name:submit' : 'name:cancel' }} onPress={() => { input.current?.focus(); void showTvKeyboard(findNodeHandle(input.current)).catch(() => {}); }} style={[box(200, 224, 560, 52), { borderRadius: 12, backgroundColor: tv.fill, paddingHorizontal: 16 }]}>
      <TextInput ref={input} value={name} onChangeText={value => { nameRef.current = value; setName(value); onChange?.(value); setError(''); }}
        onFocus={() => { activate('name:field'); void showTvKeyboard(findNodeHandle(input.current)).catch(() => {}); }}
        accessibilityLabel={field} placeholder={field} placeholderTextColor={tv.faint} returnKeyType={verb === 'Next' ? 'next' : 'done'} returnKeyLabel={verb} submitBehavior="submit"
        onSubmitEditing={() => void save()} editable={!busy} autoCorrect={false} autoCapitalize="none" secureTextEntry={secure} keyboardType={keyboardType} selectTextOnFocus={initial !== undefined} maxLength={secure || keyboardType === 'url' ? 2048 : 200}
        style={{ color: tv.text, fontFamily: fonts.sans.regular, fontSize: 19, padding: 0 }} />
    </TvButton>
    {!!error && <TvText color={tv.danger} numberOfLines={2} style={box(200, 288, 560)}>{error}</TvText>}
    {!keyboard && <View style={box(200, 332, 560, 38)}>
      <TvButton id="name:submit" label={verb} disabled={!allowEmpty && !name.trim()} onPress={() => void save()} links={{ up: busy ? undefined : 'name:field', right: busy ? undefined : 'name:cancel' }} style={[box(0, 0, 124, 38), { backgroundColor: tv.fill, alignItems: 'center' }]}><TvText color={tv.accent}>{busy ? busyLabel : verb}</TvText></TvButton>
      <TvButton id="name:cancel" label={cancelLabel} disabled={busy} onPress={cancel} links={{ up: 'name:field', left: (allowEmpty || name.trim()) && !busy ? 'name:submit' : undefined }} style={[box(140, 0, 124, 38), { backgroundColor: tv.fill, alignItems: 'center' }]}><TvText>{cancelLabel}</TvText></TvButton>
    </View>}
  </View>;
}
