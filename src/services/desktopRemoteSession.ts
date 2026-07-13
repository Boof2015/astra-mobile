import {
  DesktopRemoteHttpError,
  inspectDesktopRemoteSession,
  rotateDesktopRemoteCredentials,
} from '@/services/desktopRemoteClient';
import {
  getDesktopRemoteCredentials,
  setDesktopRemoteConnection,
  setDesktopRemoteCredentials,
  type DesktopRemoteCredentials,
} from '@/services/desktopRemoteCredentials';
import type { DesktopRemoteConnection } from '@/types/desktopRemote';

export async function ensureDesktopRemoteCredentialsFresh(
  connection: DesktopRemoteConnection,
  suppliedCredentials?: DesktopRemoteCredentials
): Promise<{ connection: DesktopRemoteConnection; credentials: DesktopRemoteCredentials }> {
  const credentials = suppliedCredentials ?? await getDesktopRemoteCredentials();
  if (!credentials) throw new Error('Desktop credentials are unavailable. Pair again.');
  let shouldRotate = false;
  try {
    const session = await inspectDesktopRemoteSession(
      connection.baseUrl,
      credentials.controlToken,
      connection.certificateFingerprint
    );
    shouldRotate = session.usingPreviousCredential || Date.now() >= session.rotateAfter;
  } catch (error) {
    if (!(error instanceof DesktopRemoteHttpError) || error.status !== 401) throw error;
    shouldRotate = true;
  }
  if (!shouldRotate) return { connection, credentials };

  const rotated = await rotateDesktopRemoteCredentials(
    connection.baseUrl,
    credentials.controlToken,
    connection.certificateFingerprint
  );
  if (!rotated.controlToken?.trim() || !rotated.syncToken?.trim()) {
    throw new Error('Desktop returned incomplete rotated credentials.');
  }
  const nextCredentials: DesktopRemoteCredentials = {
    controlToken: rotated.controlToken,
    syncToken: rotated.syncToken,
    issuedAt: rotated.issuedAt,
  };
  const nextConnection: DesktopRemoteConnection = {
    ...connection,
    credentialIssuedAt: rotated.issuedAt,
    credentialRotatedAt: rotated.issuedAt,
    lastConnectedAt: Date.now(),
  };
  await Promise.all([
    setDesktopRemoteConnection(nextConnection),
    setDesktopRemoteCredentials(nextCredentials),
  ]);
  return { connection: nextConnection, credentials: nextCredentials };
}
