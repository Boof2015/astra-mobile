import { useEffect, useState } from 'react';
import { getRemoteSecret } from '@/services/remoteCredentials';
import { useRemoteSourcesStore } from '@/stores/remoteSourcesStore';
import type { RemoteSourceRow, RemoteSourceType } from '@/types/remote';
import { defaultServerName, describeConnectError, parseServerAddress } from './serverAddress';

export type ServerFormField = 'name' | 'baseUrl' | 'username' | 'password';

export interface ServerFormMessage {
  text: string;
  ok: boolean;
}

export interface ServerConnectForm {
  type: RemoteSourceType;
  setType: (type: RemoteSourceType) => void;
  values: Record<ServerFormField, string>;
  setField: (field: ServerFormField, value: string) => void;
  /** What a blank name will become: the host, once the address parses. */
  namePlaceholder: string;
  editing: boolean;
  /** The sources store has loaded; creating before that could be clobbered by init(). */
  ready: boolean;
  canSubmit: boolean;
  busy: 'test' | 'save' | null;
  message: ServerFormMessage | null;
  test: () => Promise<void>;
  submit: () => Promise<void>;
}

/**
 * Edit path: test only when the connection details changed, then send only the
 * fields that differ. Module-level (not inside the hook) because it throws, and
 * the React Compiler bails out of any hook with a `throw` inside try/catch.
 */
async function saveEdits(
  source: RemoteSourceRow,
  next: { type: RemoteSourceType; name: string; baseUrl: string; username: string; password: string }
): Promise<void> {
  const store = useRemoteSourcesStore.getState();
  const urlChanged = next.baseUrl !== source.base_url;
  const userChanged = next.username !== source.username;
  if (urlChanged || userChanged || next.password.length > 0) {
    const password = next.password || (await getRemoteSecret(source.id));
    if (!password) throw new Error('Enter your password.');
    const result = await store.testSource({ type: next.type, baseUrl: next.baseUrl, username: next.username, password });
    if (!result.ok) throw new Error(result.message);
  }
  await store.updateSource(source.id, {
    ...(next.name !== source.name ? { name: next.name } : {}),
    ...(urlChanged ? { baseUrl: next.baseUrl } : {}),
    ...(userChanged ? { username: next.username } : {}),
    ...(next.password ? { password: next.password } : {}),
  });
}

/**
 * Connect/edit logic for a Subsonic or Jellyfin server, with no navigation in it
 * so onboarding (an overlay above the router) and Settings › Servers can both
 * host it and put the actions where their own layout needs them.
 *
 * Edit mode only tests and sends what changed. Sending an unchanged URL and
 * username made `updateSource` treat a plain rename as new credentials and drop
 * the cached Jellyfin token and cover-art template.
 */
export function useServerConnectForm({
  initialType = 'subsonic',
  source,
  onSaved,
}: {
  initialType?: RemoteSourceType;
  source?: RemoteSourceRow;
  onSaved: (id: number) => void;
}): ServerConnectForm {
  const storeReady = useRemoteSourcesStore((s) => s.initialized);
  const [type, setTypeState] = useState<RemoteSourceType>(source?.type ?? initialType);
  const [values, setValues] = useState<Record<ServerFormField, string>>({
    name: source?.name ?? '',
    baseUrl: source?.base_url ?? '',
    username: source?.username ?? '',
    password: '',
  });
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [message, setMessage] = useState<ServerFormMessage | null>(null);

  useEffect(() => {
    void useRemoteSourcesStore.getState().init().catch(() => {});
  }, []);

  const editing = source != null;
  const namePlaceholder = defaultServerName(values.baseUrl) ?? (type === 'jellyfin' ? 'My Jellyfin' : 'My server');
  const canSubmit =
    storeReady &&
    values.baseUrl.trim().length > 0 &&
    values.username.trim().length > 0 &&
    (editing || values.password.length > 0);

  const setField = (field: ServerFormField, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
    if (message && !message.ok) setMessage(null);
  };

  const setType = (next: RemoteSourceType) => {
    if (editing) return;
    setTypeState(next);
    setMessage(null);
  };

  /** The password to connect with: the typed one, or the stored one when editing. */
  const resolvePassword = async (): Promise<string | null> => {
    if (values.password) return values.password;
    return source ? getRemoteSecret(source.id) : null;
  };

  const test = async () => {
    if (busy) return;
    const address = parseServerAddress(values.baseUrl);
    if (!address.ok) {
      setMessage({ text: address.message, ok: false });
      return;
    }
    const password = await resolvePassword();
    if (!values.username.trim() || !password) {
      setMessage({ text: 'Enter your username and password to test the connection.', ok: false });
      return;
    }
    setBusy('test');
    setMessage(null);
    const result = await useRemoteSourcesStore.getState().testSource({
      type,
      baseUrl: address.baseUrl,
      username: values.username.trim(),
      password,
    });
    setMessage(
      result.ok
        ? { text: 'Connected. Everything checks out.', ok: true }
        : { text: describeConnectError(new Error(result.message), type, address.hostname), ok: false }
    );
    setBusy(null);
  };

  const submit = async () => {
    if (busy || !canSubmit) return;
    const address = parseServerAddress(values.baseUrl);
    if (!address.ok) {
      setMessage({ text: address.message, ok: false });
      return;
    }
    setBusy('save');
    setMessage(null);
    const store = useRemoteSourcesStore.getState();
    const name = values.name.trim() || address.hostname;
    const username = values.username.trim();
    try {
      if (!source) {
        const row = await store.createSource({
          type,
          name,
          baseUrl: address.baseUrl,
          username,
          password: values.password,
          enabled: true,
        });
        setBusy(null);
        onSaved(row.id);
        return;
      }
      await saveEdits(source, { type, name, baseUrl: address.baseUrl, username, password: values.password });
      setBusy(null);
      onSaved(source.id);
    } catch (error) {
      setMessage({ text: describeConnectError(error, type, address.hostname), ok: false });
      setBusy(null);
    }
  };

  return {
    type,
    setType,
    values,
    setField,
    namePlaceholder,
    editing,
    ready: storeReady,
    canSubmit,
    busy,
    message,
    test,
    submit,
  };
}
