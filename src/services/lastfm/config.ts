// Persistence for the Last.fm service config. The desktop service serializes the
// whole `LastFmServiceConfig` (including each profile's offline queue) to a JSON
// config file via its `onConfigChange` callback. On mobile we do the same, but:
//   - the config JSON (profiles + pending scrobbles + flags) → settings KV table
//   - each profile's `sessionKey` → expo-secure-store (stripped from the JSON)
// On load we re-attach the session keys before handing the config to the service,
// so the ported service code (which reads `profile.sessionKey`) is unchanged.

import { getNativeSetting, setNativeSetting } from '@/db/nativeSettings';
import type { LastFmServiceConfig } from '@/types/lastFm';
import {
  deleteLastFmSessionKey,
  getLastFmSessionKey,
  setLastFmSessionKey,
} from './credentials';

const CONFIG_KEY = 'lastfm_config';
// Tracks which profile ids currently hold a secret, so a removed profile's
// session key can be purged from secure-store on the next persist.
const SECRET_IDS_KEY = 'lastfm_secret_profile_ids';

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Load the persisted config (with session keys re-attached), or null if none. */
export async function loadLastFmConfig(): Promise<LastFmServiceConfig | null> {
  const json = await getNativeSetting(CONFIG_KEY);
  if (!json) return null;

  let parsed: LastFmServiceConfig;
  try {
    parsed = JSON.parse(json) as LastFmServiceConfig;
  } catch {
    return null;
  }
  if (!parsed || !Array.isArray(parsed.profiles)) return null;

  await Promise.all(
    parsed.profiles.map(async (profile) => {
      if (profile && typeof profile.id === 'string') {
        profile.sessionKey = await getLastFmSessionKey(profile.id);
      }
    })
  );

  return parsed;
}

/** Persist the config: secrets to secure-store, everything else to the settings KV. */
export async function persistLastFmConfig(config: LastFmServiceConfig): Promise<void> {
  const previousSecretIds = parseStringArray(await getNativeSetting(SECRET_IDS_KEY));
  const currentSecretIds: string[] = [];

  for (const profile of config.profiles) {
    if (profile.sessionKey) {
      await setLastFmSessionKey(profile.id, profile.sessionKey);
      currentSecretIds.push(profile.id);
    } else {
      await deleteLastFmSessionKey(profile.id);
    }
  }
  // Purge secrets for profiles that no longer exist (e.g. deleted custom profile).
  for (const id of previousSecretIds) {
    if (!config.profiles.some((profile) => profile.id === id)) {
      await deleteLastFmSessionKey(id);
    }
  }
  await setNativeSetting(SECRET_IDS_KEY, JSON.stringify(currentSecretIds));

  const sanitized: LastFmServiceConfig = {
    enabled: config.enabled,
    activeProfileId: config.activeProfileId,
    profiles: config.profiles.map((profile) => ({
      ...profile,
      sessionKey: null, // never written to plaintext SQLite
      pendingScrobbles: profile.pendingScrobbles.map((item) => ({ ...item })),
    })),
  };
  await setNativeSetting(CONFIG_KEY, JSON.stringify(sanitized));
}
