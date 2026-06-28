// Module-singleton wiring for the Last.fm scrobble service. Replaces the desktop
// main/index.ts wiring (env key/secret, shell.openExternal, config persistence,
// status broadcast) — but in-process, since mobile has no main/renderer split.
//
// The settings store registers a status listener via `setLastFmStatusListener`;
// the feed hook (useLastFmScrobbler) calls `publishLastFmSnapshot` / `requestLastFmFlush`.

import * as WebBrowser from 'expo-web-browser';
import {
  LASTFM_OFFICIAL_PROFILE_ID,
  type LastFmServiceConfig,
  type LastFmStatus,
} from '@/types/lastFm';
import { LASTFM_API_KEY, LASTFM_SHARED_SECRET } from './constants';
import { loadLastFmConfig, persistLastFmConfig } from './config';
import { LastFmService, type ScrobbleSnapshot } from './scrobbleService';

let service: LastFmService | null = null;
let initPromise: Promise<LastFmService> | null = null;
let statusListener: ((status: LastFmStatus) => void) | null = null;
let lastStatus: LastFmStatus | null = null;

const DEFAULT_CONFIG: LastFmServiceConfig = {
  enabled: false,
  activeProfileId: LASTFM_OFFICIAL_PROFILE_ID,
  profiles: [],
};

/**
 * Register the single status listener (the settings store). Immediately replays
 * the most recent status so a late subscriber isn't stuck on null.
 */
export function setLastFmStatusListener(fn: ((status: LastFmStatus) => void) | null): void {
  statusListener = fn;
  if (fn && lastStatus) fn(lastStatus);
}

/** Construct + start the service once, loading persisted config. Idempotent. */
export function initLastFmService(): Promise<LastFmService> {
  if (service) return Promise.resolve(service);
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const stored = await loadLastFmConfig().catch(() => null);
    const instance = new LastFmService({
      config: stored ?? DEFAULT_CONFIG,
      apiKey: LASTFM_API_KEY,
      sharedSecret: LASTFM_SHARED_SECRET,
      // Fire-and-forget: openBrowserAsync resolves only when the tab is dismissed,
      // so don't await it — beginAuth must return immediately to start auth polling.
      openExternal: async (url: string) => {
        void WebBrowser.openBrowserAsync(url);
      },
      onConfigChange: async (config) => {
        await persistLastFmConfig(config);
      },
      onStatusChange: (status) => {
        lastStatus = status;
        statusListener?.(status);
      },
    });
    service = instance;
    lastStatus = instance.getStatus();
    instance.start(); // drain any persisted offline queue on launch
    return instance;
  })();

  return initPromise;
}

/** The live service. Throws if accessed before `initLastFmService` resolves. */
export function getLastFmService(): LastFmService {
  if (!service) {
    throw new Error('Last.fm service not initialized — call initLastFmService() first.');
  }
  return service;
}

/** Feed a playback snapshot to the timing state machine (no-op until initialized). */
export function publishLastFmSnapshot(snapshot: ScrobbleSnapshot | null): void {
  service?.publishSnapshot(snapshot);
}

/** Ask the service to attempt an offline-queue flush now (foreground/connectivity resume). */
export function requestLastFmFlush(): void {
  service?.requestFlush();
}
