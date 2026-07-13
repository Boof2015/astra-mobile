export function decideDesktopSyncEnabled(
  masterSetting: string | null,
  legacyAutoSetting: string | null
): boolean {
  if (masterSetting !== null) return masterSetting !== '0';
  // Conservative migration: an explicit legacy 0 stays off; 1 or absence is on.
  return legacyAutoSetting !== '0';
}

export function canStartDesktopSync(
  enabled: boolean,
  status: 'idle' | 'syncing' | 'error'
): boolean {
  return enabled && status !== 'syncing';
}

export function identityMatchesPinnedConnection(
  expectedEndpointUuid: string | null,
  protocolVersion: number,
  observedEndpointUuid: string | null
): boolean {
  return protocolVersion === 3 && Boolean(expectedEndpointUuid) && observedEndpointUuid === expectedEndpointUuid;
}
