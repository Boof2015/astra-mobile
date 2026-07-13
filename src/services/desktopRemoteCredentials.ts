import * as SecureStore from 'expo-secure-store';
import type { DesktopRemoteConnection } from '@/types/desktopRemote';

const CONNECTION_KEY = 'desktop_remote_connection_v3';
const CREDENTIALS_KEY = 'desktop_remote_credentials_v3';
const LEGACY_CONNECTION_KEY = 'desktop_remote_connection_v1';
const LEGACY_TOKEN_KEY = 'desktop_remote_token_v1';
const SECURITY_UPGRADE_NOTICE_KEY = 'desktop_remote_security_upgrade_notice_v3';

export interface DesktopRemoteCredentials {
  controlToken: string;
  syncToken: string;
  issuedAt: number;
}

let legacyMigrationPromise: Promise<void> | null = null;

async function migrateLegacyPairing(): Promise<void> {
  legacyMigrationPromise ??= (async () => {
    const [legacyConnection, legacyToken] = await Promise.all([
      SecureStore.getItemAsync(LEGACY_CONNECTION_KEY),
      SecureStore.getItemAsync(LEGACY_TOKEN_KEY),
    ]);
    if (!legacyConnection && !legacyToken) return;
    let label = 'Astra Desktop';
    try {
      const parsed = legacyConnection ? JSON.parse(legacyConnection) as Record<string, unknown> : null;
      if (parsed && typeof parsed.desktopName === 'string' && parsed.desktopName.trim()) label = parsed.desktopName.trim();
    } catch {
      // Only a non-secret label is retained.
    }
    await Promise.all([
      SecureStore.deleteItemAsync(LEGACY_CONNECTION_KEY),
      SecureStore.deleteItemAsync(LEGACY_TOKEN_KEY),
      SecureStore.setItemAsync(SECURITY_UPGRADE_NOTICE_KEY, label),
    ]);
  })();
  await legacyMigrationPromise;
}

export async function getDesktopRemoteConnection(): Promise<DesktopRemoteConnection | null> {
  await migrateLegacyPairing();
  const raw = await SecureStore.getItemAsync(CONNECTION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DesktopRemoteConnection>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (
      typeof parsed.id !== 'string' || typeof parsed.baseUrl !== 'string' ||
      !parsed.baseUrl.startsWith('https://') || typeof parsed.certificateFingerprint !== 'string' ||
      parsed.protocolVersion !== 3
    ) return null;
    const scopes = Array.isArray(parsed.scopes)
      ? parsed.scopes.filter((scope): scope is 'control' | 'sync' => scope === 'control' || scope === 'sync')
      : [];
    if (!scopes.includes('control') || !scopes.includes('sync')) return null;
    return {
      id: parsed.id,
      baseUrl: parsed.baseUrl,
      certificateFingerprint: parsed.certificateFingerprint,
      scopes,
      credentialIssuedAt: typeof parsed.credentialIssuedAt === 'number' ? parsed.credentialIssuedAt : parsed.pairedAt ?? Date.now(),
      credentialRotatedAt: typeof parsed.credentialRotatedAt === 'number' ? parsed.credentialRotatedAt : parsed.pairedAt ?? Date.now(),
      securityUpgradeState: 'none',
      endpointUuid: typeof parsed.endpointUuid === 'string' ? parsed.endpointUuid : null,
      desktopName: typeof parsed.desktopName === 'string' ? parsed.desktopName : null,
      protocolVersion: 3,
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

export async function getDesktopRemoteCredentials(): Promise<DesktopRemoteCredentials | null> {
  const raw = await SecureStore.getItemAsync(CREDENTIALS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DesktopRemoteCredentials>;
    if (!parsed.controlToken?.trim() || !parsed.syncToken?.trim() || !Number.isFinite(parsed.issuedAt)) return null;
    return { controlToken: parsed.controlToken.trim(), syncToken: parsed.syncToken.trim(), issuedAt: parsed.issuedAt! };
  } catch {
    return null;
  }
}

export async function setDesktopRemoteCredentials(credentials: DesktopRemoteCredentials): Promise<void> {
  await SecureStore.setItemAsync(CREDENTIALS_KEY, JSON.stringify(credentials));
}

export async function getDesktopRemoteToken(): Promise<string | null> {
  return (await getDesktopRemoteCredentials())?.controlToken ?? null;
}

export async function getDesktopRemoteSyncToken(): Promise<string | null> {
  return (await getDesktopRemoteCredentials())?.syncToken ?? null;
}

export async function getDesktopRemoteSecurityUpgradeNotice(): Promise<string | null> {
  await migrateLegacyPairing();
  return SecureStore.getItemAsync(SECURITY_UPGRADE_NOTICE_KEY);
}

export async function clearDesktopRemoteSecurityUpgradeNotice(): Promise<void> {
  await SecureStore.deleteItemAsync(SECURITY_UPGRADE_NOTICE_KEY);
}

export async function clearDesktopRemotePairing(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(CONNECTION_KEY),
    SecureStore.deleteItemAsync(CREDENTIALS_KEY),
  ]);
}
