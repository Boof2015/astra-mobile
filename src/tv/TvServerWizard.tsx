import { useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import type { RemoteSourceRow, RemoteSourceType } from '@/types/remote';
import { useRemoteSourcesStore } from '@/stores/remoteSourcesStore';
import { getRemoteSecret } from '@/services/remoteCredentials';
import { useTvBackHandler } from './TvBack';
import { useTvActive } from './TvFocus';
import { TvNameFlow } from './TvNameFlow';

export function TvServerWizard({ type, source, close, saved }: {
  type: RemoteSourceType; source?: RemoteSourceRow; close: () => void; saved: (id: number) => void;
}) {
  const active = useTvActive(); const [step, setStep] = useState(0); const busy = useRef(false);
  const [draft, setDraft] = useState({ url: source?.base_url ?? '', username: source?.username ?? '', secret: '' });
  const label = type === 'jellyfin' ? 'Jellyfin' : 'Subsonic';
  const field = (['url', 'username', 'secret'] as const)[step];
  const back = () => { if (busy.current) return; Keyboard.dismiss(); if (step) setStep(step - 1); else close(); };
  useTvBackHandler(active, () => { if (Keyboard.isVisible()) Keyboard.dismiss(); else back(); return true; });
  const submit = async (value: string) => {
    const values = { ...draft, [field]: value };
    setDraft(values);
    if (step === 0) {
      try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error(); }
      catch { throw new Error('Enter an http:// or https:// address. Your login comes next.'); }
    } else if (step === 1 && !value.trim()) throw new Error('Enter your username.');
    if (step < 2) { setStep(step + 1); return; }
    if (busy.current) return;
    busy.current = true;
    try {
      const store = useRemoteSourcesStore.getState();
      const password = values.secret || (source ? await getRemoteSecret(source.id) : null);
      if (password == null || (!source && !password)) throw new Error('Enter your password.');
      const input = { type, name: source?.name ?? new URL(values.url).hostname, baseUrl: values.url.trim(), username: values.username.trim(), password, enabled: true };
      let id: number;
      if (source) {
        const changed = input.baseUrl !== source.base_url || input.username !== source.username || !!values.secret;
        if (changed) { const result = await store.testSource(input); if (!result.ok) throw new Error(result.message); }
        await store.updateSource(source.id, {
          ...(input.baseUrl !== source.base_url ? { baseUrl: input.baseUrl } : {}),
          ...(input.username !== source.username ? { username: input.username } : {}),
          ...(values.secret ? { password: values.secret } : {}),
        });
        id = source.id;
      } else id = (await store.createSource(input)).id;
      Keyboard.dismiss(); saved(id);
    } finally { busy.current = false; }
  };
  return <TvNameFlow key={step} initial={draft[field]} allowEmpty trim={field !== 'secret'} secure={field === 'secret'}
    keyboardType={field === 'url' ? 'url' : 'default'} onChange={value => setDraft(previous => ({ ...previous, [field]: value }))} cancel={back} cancelLabel="Back" busyLabel="Connecting…" submit={submit}
    labels={{ eyebrow: `${source ? 'EDIT' : 'CONNECT'} ${label.toUpperCase()} · ${step + 1} OF 3`,
      title: ['Where is your server?', 'Your username', 'Your password'][step],
      field: ['Server address', 'Username', 'Password'][step],
      description: ['Include http:// or https:// and the port, if needed.', `Enter your username on ${label}.`, source ? 'Leave blank to keep your saved password.' : 'Connect to add your music. You can name this connection afterward.'][step],
      verb: step < 2 ? 'Next' : source ? 'Save changes' : 'Connect' }} />;
}
