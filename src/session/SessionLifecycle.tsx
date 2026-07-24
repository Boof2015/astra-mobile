import { useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import {
  useGlobalSearchParams,
  usePathname,
  useRootNavigationState,
  useRouter,
  useSegments,
} from 'expo-router';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { useSettingsStore } from '@/stores/settingsStore';
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
  rememberStableHref,
  setInitialStableHref,
} from './sessionPersistence';
import {
  normalizeStableHref,
  resolvePlaybackSession,
  shouldRestoreSavedRoute,
  stableHrefForRoute,
} from './sessionState';

interface SessionLifecycleProps {
  onReady: () => void;
}

async function validateSavedHref(href: string): Promise<string> {
  const normalized = normalizeStableHref(href) ?? '/';
  const [pathname, query = ''] = normalized.split('?', 2);
  const albumMatch = pathname.match(/^\/library\/album\/([^/]+)$/);
  if (albumMatch) {
    const key = decodeURIComponent(albumMatch[1]);
    const result = await AstraLibraryData.getAlbumDetail<DbTrack, Record<string, unknown>>(
      key,
      null,
      1
    );
    return result.summary ? normalized : '/library';
  }
  const artistMatch = pathname.match(
    /^\/library\/artist\/([^/]+)(?:\/(?:albums|songs|appearances))?$/
  );
  if (artistMatch) {
    const name = decodeURIComponent(artistMatch[1]);
    const groupingMode = new URLSearchParams(query).get('credit') === '1'
      ? 'astra'
      : useSettingsStore.getState().artistGroupingMode;
    const result = await AstraLibraryData.getArtistDetail<DbTrack, Record<string, unknown>>(
      name,
      groupingMode,
      'all',
      null,
      1
    );
    return result.summary ? normalized : '/library';
  }
  const playlistMatch = pathname.match(/^\/library\/playlist\/(favorites|\d+)$/);
  if (
    playlistMatch &&
    playlistMatch[1] !== 'favorites' &&
    !usePlaylistStore.getState().playlists.some((playlist) => playlist.id === Number(playlistMatch[1]))
  ) {
    return '/library';
  }
  return normalized;
}

/** Restores once, then owns stable-route tracking and session autosave. */
export function SessionLifecycle({ onReady }: SessionLifecycleProps) {
  const router = useRouter();
  const pathname = usePathname();
  const segments = useSegments();
  const params = useGlobalSearchParams<{
    key?: string | string[];
    name?: string | string[];
    id?: string | string[];
    credit?: string | string[];
  }>();
  const rootNavigationState = useRootNavigationState();
  const navigationKey = rootNavigationState?.key;
  const initialPathname = useRef(pathname);
  const started = useRef(false);
  const uninstallPersistence = useRef<(() => void) | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!navigationKey || started.current) return;
    started.current = true;
    let cancelled = false;

    void (async () => {
      const snapshotRead = readPersistedMobileSession();
      let snapshot: Awaited<typeof snapshotRead> = null;
      try {
        const [loadedSnapshot, initialUrl] = await Promise.all([
          snapshotRead,
          Linking.getInitialURL(),
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
        // inside a still-live JS process.
        usePlayerUiStore.setState({ playerOpen: false });
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

        const stableHref = await validateSavedHref(snapshot?.lastStableHref ?? '/');
        setInitialStableHref(stableHref);
        if (shouldRestoreSavedRoute(initialPathname.current, initialUrl) && stableHref !== '/') {
          router.replace(stableHref as never);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }

        uninstallPersistence.current = installMobileSessionPersistence(
          snapshot?.playback ?? null
        );
        setHydrated(true);
      } catch (error) {
        if (cancelled) return;
        console.warn('[session] restore failed', error);
        try {
          snapshot ??= await snapshotRead;
        } catch {
          // The normal empty-session fallback below remains safe.
        }
        if (cancelled) return;
        setInitialStableHref(
          normalizeStableHref(snapshot?.lastStableHref)
            ?? normalizeStableHref(initialPathname.current)
            ?? '/'
        );
        uninstallPersistence.current = installMobileSessionPersistence(snapshot?.playback ?? null);
        setHydrated(true);
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
  }, [navigationKey, onReady, router]);

  useEffect(() => {
    if (!hydrated) return;
    rememberStableHref(stableHrefForRoute(segments, pathname, params));
  }, [hydrated, params, pathname, segments]);

  return null;
}
