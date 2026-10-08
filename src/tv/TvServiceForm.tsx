import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, View } from 'react-native';
import { useLastFmSettingsStore } from '@/stores/lastFmSettingsStore';
import type { RemoteSourceRow, RemoteSourceType } from '@/types/remote';
import type { LastFmProfileStatus, LastFmScrobbleProtocol } from '@/types/lastFm';
import { useTvBackHandler } from './TvBack';
import { TvButton, TvFocusRegion, useTvActive, useTvFocus } from './TvFocus';
import { TvNameFlow } from './TvNameFlow';
import { TvSettingsRows, settingsRowId, type SettingsRow } from './TvSettingsRows';
import { box, TvText } from './TvPrimitives';
import { useTvTheme } from './useTvTheme';
import { TvServerWizard } from './TvServerWizard';

export type ServiceForm = { kind: 'server'; type: RemoteSourceType; source?: RemoteSourceRow }
  | { kind: 'scrobbler'; protocol: LastFmScrobbleProtocol; profile?: LastFmProfileStatus };
const protocolNames = { lastfm2: 'Last.fm 2.0', audioscrobbler: 'AudioScrobbler', listenbrainz: 'ListenBrainz' };
const defaultUrls = { lastfm2: 'https://libre.fm/2.0/', audioscrobbler: 'http://post.audioscrobbler.com/', listenbrainz: 'https://api.listenbrainz.org' };
const page = 'service-form';
type Field = { id: 'name' | 'url' | 'username' | 'secret'; label: string; description: string; secure?: boolean };

function useConnectionTask() {
  const [busy, setBusy] = useState<string | null>(null); const lock = useRef(false);
  const task = useCallback(async (id: string, action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(id);
    try { await action(); } finally { lock.current = false; setBusy(null); }
  }, []);
  return { busy, task };
}

/** Keep the form on the TV; OK edits one field with the system keyboard. */
export function TvServiceForm({ form, close, saved }: { form: ServiceForm; close: () => void; saved: (id: number | string) => void }) {
  if (form.kind === 'server') return <TvServerWizard type={form.type} source={form.source} close={close} saved={saved} />;
  return <TvServiceFields form={form} close={close} saved={saved} />;
}

function TvServiceFields({ form, close, saved }: { form: Extract<ServiceForm, { kind: 'scrobbler' }>; close: () => void; saved: (id: number | string) => void }) {
  const tv = useTvTheme(); const active = useTvActive(); const { request } = useTvFocus();
  const editing = form.profile; const label = protocolNames[form.protocol];
  const [draft, setDraft] = useState({ name: editing?.name ?? label, url: form.profile?.apiBaseUrl ?? defaultUrls[form.protocol], username: editing?.username ?? '', secret: '' });
  const [field, setField] = useState<Field | null>(null); const [remembered, setRemembered] = useState('name');
  const { busy, task } = useConnectionTask();
  const [message, setMessage] = useState('');
  useEffect(() => { request(settingsRowId(page, 'name')); }, [request]);
  const closeField = () => { if (!field) return; Keyboard.dismiss(); setField(null); request(settingsRowId(page, field.id)); };
  useTvBackHandler(active, () => {
    if (field) { if (Keyboard.isVisible()) Keyboard.dismiss(); else closeField(); }
    else if (!busy) close();
    return true;
  });
  const fields: Field[] = [
    { id: 'name', label: 'Name', description: 'A name to recognize this connection.' },
    { id: 'url', label: 'API URL', description: 'Include http:// or https:// and the port, if needed.' },
    ...(form.protocol !== 'listenbrainz' ? [{ id: 'username' as const, label: 'Username', description: 'Your username on this service.' }] : []),
    { id: 'secret', label: form.protocol === 'listenbrainz' ? 'Auth token' : form.protocol === 'audioscrobbler' ? 'Password / API key' : 'Session key', secure: true,
      description: editing ? 'Leave blank to keep the saved credential.' : 'Enter the credential provided by your scrobbling service.' },
  ];
  const perform = async () => {
    if (busy) return;
    if (!draft.name.trim() || !draft.url.trim() || (!editing && !draft.secret)) { setMessage('Enter a name, API URL and service credential.'); return; }
    if (form.profile && draft.url.trim() !== form.profile.apiBaseUrl && !draft.secret.trim()) { setMessage('Enter the credential again when changing the destination URL.'); return; }
    try { const url = new URL(draft.url.trim()); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(); }
    catch { setMessage('Enter an http:// or https:// address. Enter credentials in their own fields.'); return; }
    await task('save', async () => {
    setMessage('');
    try {
        const store = useLastFmSettingsStore.getState(); const ids = new Set(store.status?.profiles.map(profile => profile.id));
        const input = { protocol: form.protocol, name: draft.name.trim(), apiBaseUrl: draft.url.trim(), username: form.protocol === 'listenbrainz' ? null : draft.username.trim() || null, sessionKey: draft.secret.trim() || null };
        const result = form.profile ? await store.updateCustomProfile(form.profile.id, input) : await store.createCustomProfile(input);
        if (!result || result.lastError) throw new Error(result?.lastError || useLastFmSettingsStore.getState().errorMessage || 'Could not save destination.');
        const id = form.profile?.id ?? result.profiles.find(profile => !ids.has(profile.id))?.id;
        if (id) saved(id);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not connect. Check the details and try again.'); }
    });
  };
  const rows: SettingsRow[] = fields.map(item => ({ id: item.id, kind: 'link', label: item.label, value: item.secure ? draft.secret ? '••••••••' : editing ? 'Unchanged' : 'Not entered' : draft[item.id] || 'Not entered', disabled: !!busy, run: () => setField(item) }));
  rows.push({ id: 'save', kind: 'action', label: busy === 'save' ? 'Saving…' : editing ? 'Save changes' : 'Add destination', disabled: !!busy && busy !== 'save', run: () => void perform() });
  return <View style={[box(0, 0, 960, 540), { backgroundColor: tv.bg }]}>
    <TvFocusRegion enabled={!field}>
      <TvButton id="service:back" label="Back" disabled={!!busy} onPress={close} links={{ right: settingsRowId(page, remembered), down: settingsRowId(page, remembered) }} style={[box(51, 84, 176, 36), { paddingHorizontal: 14 }]}><TvText color={tv.muted}>‹ {editing ? 'Connection' : 'Service type'}</TvText></TvButton>
      <TvText size={24} weight="semibold" style={box(263, 80, 646)}>{editing ? `Edit ${label}` : `Connect ${label}`}</TvText>
      <TvText size={13} color={tv.muted} style={box(263, 114, 646)}>OK to edit a field · Back discards unsaved changes</TvText>
      <TvSettingsRows rows={rows} page={page} remembered={remembered} left="service:back" up="service:back" grab={null} enter={setRemembered} press={row => { if (row.kind === 'link' || row.kind === 'action') row.run(); }} adjust={() => {}} />
      {!!message && <TvText size={11.5} color={tv.muted} numberOfLines={2} style={box(263, 500, 646)}>{message}</TvText>}
    </TvFocusRegion>
    {field && <TvFocusRegion enabled><TvNameFlow key={field.id} allowEmpty secure={field.secure} trim={!field.secure} keyboardType={field.id === 'url' ? 'url' : 'default'} initial={draft[field.id]}
      labels={{ eyebrow: label.toUpperCase(), title: field.label, description: field.description, field: field.label, verb: 'Use value' }}
      submit={async value => { setDraft(previous => ({ ...previous, [field.id]: value })); setMessage(''); closeField(); }} cancel={closeField} /></TvFocusRegion>}
  </View>;
}
