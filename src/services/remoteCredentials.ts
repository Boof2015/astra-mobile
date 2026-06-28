// Server passwords live in the Android Keystore (expo-secure-store), keyed by the
// remote_sources row id. Subsonic needs the plaintext password at request time to
// compute the per-request salted token; Jellyfin needs it to (re)authenticate.

import * as SecureStore from 'expo-secure-store';

function secretKey(sourceId: number): string {
  // SecureStore keys must be alphanumeric + ".-_" — this satisfies that.
  return `remote_secret_${sourceId}`;
}

export async function getRemoteSecret(sourceId: number): Promise<string | null> {
  return SecureStore.getItemAsync(secretKey(sourceId));
}

export async function setRemoteSecret(sourceId: number, password: string): Promise<void> {
  await SecureStore.setItemAsync(secretKey(sourceId), password);
}

export async function deleteRemoteSecret(sourceId: number): Promise<void> {
  await SecureStore.deleteItemAsync(secretKey(sourceId));
}
