// Server passwords live in the Android Keystore (expo-secure-store), keyed by the
// remote_sources row id. Subsonic needs the plaintext password at request time to
// compute the per-request salted token; Jellyfin needs it to (re)authenticate.

import * as SecureStore from 'expo-secure-store';

function secretKey(sourceId: number, field = 'password'): string {
  // SecureStore keys must be alphanumeric + ".-_" — this satisfies that.
  return `astra_room_v1_remote_${field}_${sourceId}`;
}

export async function getRemoteSecret(sourceId: number): Promise<string | null> {
  return SecureStore.getItemAsync(secretKey(sourceId, 'password'));
}

export async function setRemoteSecret(sourceId: number, password: string): Promise<void> {
  await SecureStore.setItemAsync(secretKey(sourceId, 'password'), password);
}

export async function deleteRemoteSecret(sourceId: number): Promise<void> {
  await Promise.all(
    ['password', 'access_token', 'user_id', 'device_id', 'art_auth'].map((field) =>
      SecureStore.deleteItemAsync(secretKey(sourceId, field))
    )
  );
}

export interface RemoteSecureAuth {
  accessToken: string | null;
  userId: string | null;
  deviceId: string | null;
  artAuth: string | null;
}

export async function getRemoteSecureAuth(sourceId: number): Promise<RemoteSecureAuth> {
  const [accessToken, userId, deviceId, artAuth] = await Promise.all(
    ['access_token', 'user_id', 'device_id', 'art_auth'].map((field) =>
      SecureStore.getItemAsync(secretKey(sourceId, field))
    )
  );
  return { accessToken, userId, deviceId, artAuth };
}

async function setOptionalSecret(
  sourceId: number,
  field: string,
  value: string | null,
): Promise<void> {
  const key = secretKey(sourceId, field);
  if (value == null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}

export async function setRemoteSecureAuth(
  sourceId: number,
  auth: {
    accessToken: string | null;
    userId: string | null;
    deviceId: string | null;
  },
): Promise<void> {
  await Promise.all([
    setOptionalSecret(sourceId, 'access_token', auth.accessToken),
    setOptionalSecret(sourceId, 'user_id', auth.userId),
    setOptionalSecret(sourceId, 'device_id', auth.deviceId),
  ]);
}

export async function setRemoteArtAuth(sourceId: number, value: string | null): Promise<void> {
  await setOptionalSecret(sourceId, 'art_auth', value);
}
