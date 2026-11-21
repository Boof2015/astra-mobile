import type { RemoteSourceRow, RemoteSyncProgress } from '../../types/remote.ts';

export interface SourceStatus {
  text: string;
  tone: 'normal' | 'error';
}

/** Settings › Servers list row: the full story, including when it last synced. */
export function statusLine(source: RemoteSourceRow, progress: RemoteSyncProgress | null): SourceStatus {
  if (!source.enabled) return { text: 'Disabled', tone: 'normal' };
  if (progress) {
    const pct = progress.total > 0 ? ` ${progress.current}/${progress.total}` : '';
    return { text: `Syncing… ${progress.phase}${pct}`, tone: 'normal' };
  }
  if (source.last_status === 'error') {
    return { text: source.last_error ?? 'Sync failed', tone: 'error' };
  }
  if (source.last_sync_at) {
    return { text: `Last synced ${new Date(source.last_sync_at).toLocaleString()}`, tone: 'normal' };
  }
  return { text: 'Not synced yet', tone: 'normal' };
}

export type ServerRowState = 'syncing' | 'connected' | 'error' | 'waiting';

/** Onboarding's "Added" row: type first, then one short state. */
export function onboardingServerStatus(
  source: RemoteSourceRow,
  progress: RemoteSyncProgress | null
): SourceStatus & { state: ServerRowState } {
  const kind = source.type === 'jellyfin' ? 'Jellyfin' : 'Subsonic';
  if (progress) {
    const detail =
      progress.phase === 'connecting'
        ? 'Connecting'
        : progress.total > 0
          ? `Syncing ${progress.phase} · ${progress.current.toLocaleString('en-US')} / ${progress.total.toLocaleString('en-US')}`
          : `Syncing ${progress.phase}`;
    return { text: `${kind} · ${detail}`, tone: 'normal', state: 'syncing' };
  }
  if (source.last_status === 'error') {
    return { text: source.last_error ?? `${kind} · Sync failed`, tone: 'error', state: 'error' };
  }
  if (source.last_sync_at) return { text: `${kind} · Connected`, tone: 'normal', state: 'connected' };
  return { text: `${kind} · Waiting to sync`, tone: 'normal', state: 'waiting' };
}
