import * as SecureStore from 'expo-secure-store';
import type { DesktopRemoteConnection } from '@/types/desktopRemote';

const CONNECTION_KEY = 'desktop_remote_connection_v1';
const TOKEN_KEY = 'desktop_remote_token_v1';

export async function getDesktopRemoteConnection(): Promise<DesktopRemoteConnection | null> {
  const raw = await SecureStore.getItemAsync(CONNECTION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DesktopRemoteConnection>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.id !== 'string' || typeof parsed.baseUrl !== 'string') return null;
    return {
      id: parsed.id,
      baseUrl: parsed.baseUrl,
      endpointUuid: typeof parsed.endpointUuid === 'string' ? parsed.endpointUuid : null,
      desktopName: typeof parsed.desktopName === 'string' ? parsed.desktopName : null,
      protocolVersion:
        typeof parsed.protocolVersion === 'number' && Number.isFinite(parsed.protocolVersion)
          ? parsed.protocolVersion
          : 1,
      deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : null,
      pairedAt:
        typeof parsed.pairedAt === 'number' && Number.isFinite(parsed.pairedAt)
          ? parsed.pairedAt
          : Date.now(),
      lastConnectedAt:
        typeof parsed.lastConnectedAt === 'number' && Number.isFinite(parsed.lastConnectedAt)
          ? parsed.lastConnectedAt
          : null,
    };
  } catch {
    return null;
  }
}

export async function setDesktopRemoteConnection(connection: DesktopRemoteConnection): Promise<void> {
  await SecureStore.setItemAsync(CONNECTION_KEY, JSON.stringify(connection));
}

export async function getDesktopRemoteToken(): Promise<string | null> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  return token && token.trim() ? token.trim() : null;
}

export async function setDesktopRemoteToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearDesktopRemotePairing(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(CONNECTION_KEY),
    SecureStore.deleteItemAsync(TOKEN_KEY),
  ]);
}
