// Desktop LAN sync status + triggers. The engine itself lives in
// src/services/desktopSync.ts; this store serializes runs (one at a time),
// debounces the automatic triggers, and exposes last-synced state for the UI.
// Module-scope timers (not component state) per the React Compiler rules.

import { AppState } from 'react-native';
import { create } from 'zustand';
import { openLibraryDb } from '@/db/database';
import { getSetting, setSetting } from '@/db/queries';
import {
  DesktopSyncUnsupportedError,
  applyDesktopSyncConflictResolution,
  desktopSyncSettingKey,
  runDesktopSync,
} from '@/services/desktopSync';
import { getDesktopRemoteConnection } from '@/services/desktopRemoteCredentials';
import { fetchDesktopRemoteIdentity } from '@/services/desktopRemoteClient';
import { canStartDesktopSync, decideDesktopSyncEnabled } from '@/services/desktopSyncPolicy';
import type {
  DesktopSyncConflictResolution,
  DesktopSyncPlaylistConflict,
  DesktopSyncSummary,
} from '@/types/desktopSync';

const AUTO_SYNC_DEBOUNCE_MS = 5_000;
const AUTO_SYNC_MIN_INTERVAL_MS = 15 * 60_000;
const DESKTOP_SYNC_ENABLED_SETTING_KEY = 'desktop_sync_enabled_v1';
const LEGACY_AUTO_SYNC_SETTING_KEY = 'desktop_sync_auto';

export type DesktopSyncStatus = 'idle' | 'syncing' | 'error';

export type DesktopSyncAutoReason = 'discovery' | 'connected' | 'foreground';

interface DesktopSyncStore {
  hydrated: boolean;
  status: DesktopSyncStatus;
  /** Wall-clock ms of the last successful sync with the paired desktop. */
  lastSyncAt: number | null;
  lastSummary: DesktopSyncSummary | null;
  /** Playlists the last run refused to resolve automatically. */
  conflicts: DesktopSyncPlaylistConflict[];
  /** True while a NEW conflict awaits its once-per-session popup
   *  (SyncConflictPrompt); set by syncNow, cleared on dismiss/resolve. */
  conflictPromptVisible: boolean;
  errorMessage: string;
  /** False once the paired desktop reported a pre-sync protocol version. */
  supported: boolean;
  /** Master gate for every desktop library-sync trigger. Remote playback is independent. */
  desktopSyncEnabled: boolean;

  hydrate: () => Promise<void>;
  syncNow: () => Promise<void>;
  dismissConflictPrompt: () => void;
  setDesktopSyncEnabled: (enabled: boolean) => Promise<void>;
  resolveConflict: (
    conflict: DesktopSyncPlaylistConflict,
    resolution: DesktopSyncConflictResolution
  ) => Promise<void>;
  maybeAutoSync: (reason: DesktopSyncAutoReason) => void;
  /** Desktop clicked Sync Now (or resolved a conflict there) — sync promptly,
   *  bypassing the auto-sync interval limits. */
  handleSyncRequest: () => void;
}

let autoSyncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
// One popup per conflict per app session — dismissing must not re-nag on the
// next sync run re-detecting the same conflicts.
const promptedConflictUids = new Set<string>();

export const useDesktopSyncStore = create<DesktopSyncStore>((set, get) => ({
  hydrated: false,
  status: 'idle',
  lastSyncAt: null,
  lastSummary: null,
  conflicts: [],
  conflictPromptVisible: false,
  errorMessage: '',
  supported: true,
  desktopSyncEnabled: false,

  hydrate: async () => {
    try {
      const db = await openLibraryDb();
      const masterSetting = await getSetting(db, DESKTOP_SYNC_ENABLED_SETTING_KEY);
      const legacySetting = await getSetting(db, LEGACY_AUTO_SYNC_SETTING_KEY);
      const enabled = decideDesktopSyncEnabled(masterSetting, legacySetting);
      set({ desktopSyncEnabled: enabled });
      if (masterSetting === null) {
        await setSetting(db, DESKTOP_SYNC_ENABLED_SETTING_KEY, enabled ? '1' : '0');
      }
      const connection = await getDesktopRemoteConnection();
      if (connection) {
        const stored = await getSetting(db, desktopSyncSettingKey(connection));
        const lastSyncAt = stored ? Number(stored) : NaN;
        if (Number.isFinite(lastSyncAt) && lastSyncAt > 0) {
          set({ lastSyncAt });
        }
      }
    } catch {
      // Hydration is best-effort; the first sync will set lastSyncAt.
    } finally {
      set({ hydrated: true });
    }
  },

  setDesktopSyncEnabled: async (enabled) => {
    if (!enabled && autoSyncDebounceTimer !== null) {
      clearTimeout(autoSyncDebounceTimer);
      autoSyncDebounceTimer = null;
    }
    set({ desktopSyncEnabled: enabled });
    try {
      const db = await openLibraryDb();
      await setSetting(db, DESKTOP_SYNC_ENABLED_SETTING_KEY, enabled ? '1' : '0');
    } catch {
      // The in-memory value still applies for this session.
    }
  },

  syncNow: async () => {
    if (!canStartDesktopSync(get().desktopSyncEnabled, get().status)) return;
    set({ status: 'syncing', errorMessage: '' });
    try {
      const summary = await runDesktopSync();
      let conflictPromptVisible = get().conflictPromptVisible;
      if (summary.conflicts.length === 0) {
        promptedConflictUids.clear();
        conflictPromptVisible = false;
      } else if (summary.conflicts.some((conflict) => !promptedConflictUids.has(conflict.syncUid))) {
        for (const conflict of summary.conflicts) {
          promptedConflictUids.add(conflict.syncUid);
        }
        conflictPromptVisible = true;
      }
      set({
        status: 'idle',
        lastSyncAt: summary.finishedAt,
        lastSummary: summary,
        conflicts: summary.conflicts,
        conflictPromptVisible,
        supported: true,
      });
    } catch (error) {
      set({
        status: 'error',
        errorMessage:
          error instanceof Error && error.message.trim() ? error.message : 'Desktop sync failed.',
        supported: !(error instanceof DesktopSyncUnsupportedError),
      });
    }
  },

  resolveConflict: async (conflict, resolution) => {
    if (!canStartDesktopSync(get().desktopSyncEnabled, get().status)) return;
    try {
      await applyDesktopSyncConflictResolution(conflict, resolution);
    } catch (error) {
      set({
        status: 'error',
        errorMessage:
          error instanceof Error && error.message.trim()
            ? error.message
            : 'Failed to resolve the sync conflict.',
      });
      return;
    }
    // Drop it optimistically; the follow-up sync re-detects anything unsettled.
    set((state) => ({
      conflicts: state.conflicts.filter((entry) => entry.syncUid !== conflict.syncUid),
    }));
    await get().syncNow();
  },

  dismissConflictPrompt: () => {
    set({ conflictPromptVisible: false });
  },

  handleSyncRequest: () => {
    const { status, desktopSyncEnabled } = get();
    if (!canStartDesktopSync(desktopSyncEnabled, status)) return;
    void get().syncNow();
  },

  maybeAutoSync: (reason) => {
    const { status, lastSyncAt, supported, desktopSyncEnabled } = get();
    if (!supported || !desktopSyncEnabled) return;
    if (status === 'syncing') return;
    if (AppState.currentState !== 'active') return;
    if (lastSyncAt !== null && Date.now() - lastSyncAt < AUTO_SYNC_MIN_INTERVAL_MS) return;

    // Discovery/connect events arrive in bursts — coalesce them.
    if (autoSyncDebounceTimer !== null) clearTimeout(autoSyncDebounceTimer);
    autoSyncDebounceTimer = setTimeout(() => {
      autoSyncDebounceTimer = null;
      void (async () => {
        const state = useDesktopSyncStore.getState();
        if (!state.desktopSyncEnabled) return;
        if (state.status === 'syncing') return;
        if (AppState.currentState !== 'active') return;
        if (state.lastSyncAt !== null && Date.now() - state.lastSyncAt < AUTO_SYNC_MIN_INTERVAL_MS) return;
        // Automatic triggers are speculative — probe reachability first so an
        // off-LAN desktop doesn't surface an error banner from an attempt the
        // user never asked for.
        const connection = await getDesktopRemoteConnection();
        if (!connection) return;
        const identity = await fetchDesktopRemoteIdentity(
          connection.baseUrl,
          connection.certificateFingerprint
        );
        if (!identity) return;
        void state.syncNow();
      })();
    }, AUTO_SYNC_DEBOUNCE_MS);
    void reason;
  },
}));
