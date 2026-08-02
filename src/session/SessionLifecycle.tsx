import { useEffect, useRef } from 'react';
import { useRootNavigationState } from 'expo-router';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlayerUiStore } from '@/stores/playerUiStore';
import { useSearchStore } from '@/stores/searchStore';
import { useRemoteSourcesStore } from '@/stores/remoteSourcesStore';
import { dbTrackToTrack } from '@/library/trackAdapter';
import {
  hasActiveNativePlaybackSession,
  restorePlaybackSession,
  restoreVirtualPlaybackContext,
} from '@/audio/playbackController';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import type { DbTrack } from '@/types/library';
import {
  installMobileSessionPersistence,
  readPersistedMobileSession,
} from './sessionPersistence';
import { resolvePlaybackSession } from './sessionState';

interface SessionLifecycleProps {
  onReady: () => void;
}

/**
 * Restores the playback session once, then owns session autosave.
 *
 * Deliberately does *not* restore the route. Closing an app on mobile means
 * "start me fresh"; leaving it in recents keeps the task alive, and React
 * Navigation already holds that state in memory without our help. So a cold
 * launch falls through to the router's own initial route (Home) and only the
 * queue, current track, and position come back off disk.
 */
export function SessionLifecycle({ onReady }: SessionLifecycleProps) {
  // The navigator does not gate anything we restore, but the effect resets the
  // player overlay, so let the router mount its first screen before we run.
  const rootNavigationState = useRootNavigationState();
  const navigationKey = rootNavigationState?.key;
  const started = useRef(false);
  const uninstallPersistence = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!navigationKey || started.current) return;
    started.current = true;
    let cancelled = false;

    void (async () => {
      const snapshotRead = readPersistedMobileSession();
      let snapshot: Awaited<typeof snapshotRead> = null;
      try {
        const [loadedSnapshot] = await Promise.all([
          snapshotRead,
          (async () => {
            await useLibraryStore.getState().initialize();
            try {
              await useRemoteSourcesStore.getState().init();
            } catch (error) {
              // Local queue/session recovery should still work when a remote
              // source cannot hydrate during startup.
              console.warn('[session] remote source hydration failed', error);
            }
          })(),
        ]);
        snapshot = loadedSnapshot;
        if (cancelled) return;

        // Every relaunch begins at rest even when a React activity was rebuilt
        // inside a still-live JS process — unless something already asked for the
        // player during startup (a notification or widget tap resolves before
        // these awaits finish, and used to be silently overridden here).
        if (usePlayerUiStore.getState().openRequest === 0) {
          usePlayerUiStore.setState({ phase: 'closed' });
        }
        useSearchStore.getState().closeQuickSearch();

        const liveNativeSession = await hasActiveNativePlaybackSession();
        if (!cancelled && snapshot?.playback && !liveNativeSession) {
          const nativeContext = await AstraLibraryData.restorePlaybackContext<DbTrack>();
          if (nativeContext) {
            restoreVirtualPlaybackContext(nativeContext, snapshot.playback);
          } else {
            const resolved = resolvePlaybackSession(
              snapshot.playback,
              useLibraryStore.getState().tracks
            );
            restorePlaybackSession(
              resolved
                ? { ...resolved, tracks: resolved.tracks.map(dbTrackToTrack) }
                : null
            );
          }
        }
        if (cancelled) return;

        uninstallPersistence.current = installMobileSessionPersistence(
          snapshot?.playback ?? null
        );
      } catch (error) {
        if (cancelled) return;
        console.warn('[session] restore failed', error);
        try {
          snapshot ??= await snapshotRead;
        } catch {
          // The normal empty-session fallback below remains safe.
        }
        if (cancelled) return;
        // A failed restore must never leave autosave uninstalled.
        uninstallPersistence.current = installMobileSessionPersistence(snapshot?.playback ?? null);
      } finally {
        if (!cancelled) onReady();
      }
    })();

    return () => {
      cancelled = true;
      started.current = false;
      uninstallPersistence.current?.();
      uninstallPersistence.current = null;
    };
  }, [navigationKey, onReady]);

  return null;
}
