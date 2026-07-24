// Per-profile Last.fm session keys / tokens live in the Android Keystore
// (expo-secure-store), keyed by profile id — mirroring the M5 remote-source
// password pattern (src/services/remoteCredentials.ts). The rest of the scrobble
// config (profiles, offline queue) is plain JSON in the settings table; only the
// secret leaves SQLite.

import * as SecureStore from 'expo-secure-store';

function secretKey(profileId: string): string {
  // SecureStore keys must be alphanumeric + ".-_" — sanitize the profile id.
  const safe = profileId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `astra_room_v1_lastfm_session_${safe}`;
}

export async function getLastFmSessionKey(profileId: string): Promise<string | null> {
  return SecureStore.getItemAsync(secretKey(profileId));
}

export async function setLastFmSessionKey(profileId: string, sessionKey: string): Promise<void> {
  await SecureStore.setItemAsync(secretKey(profileId), sessionKey);
}

export async function deleteLastFmSessionKey(profileId: string): Promise<void> {
  await SecureStore.deleteItemAsync(secretKey(profileId));
}
