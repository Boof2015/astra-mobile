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
import { buildArtistDetail } from '@/library/artistDetail';
import { dbTrackToTrack } from '@/library/trackAdapter';
import {
  hasActiveNativePlaybackSession,
  restorePlaybackSession,
} from '@/audio/playbackController';
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
  validateRestoredHref,
} from './sessionState';

interface SessionLifecycleProps {
  onReady: () => void;
}

function validateSavedHref(href: string): string {
  const tracks = useLibraryStore.getState().tracks;
  return validateRestoredHref(href, {
    hasAlbum: (identityKey) => tracks.some((track) => track.album_identity_key === identityKey),
    hasArtist: (name, credit) => {
      const groupingMode = credit ? 'astra' : useSettingsStore.getState().artistGroupingMode;
      return buildArtistDetail(tracks, name, groupingMode).tracks.length > 0;
    },
    hasPlaylist: (id) => usePlaylistStore.getState().playlists.some((playlist) => playlist.id === id),
  });
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
        usePlayerUiStore.setState({ playerOpen: false, everOpened: false });
        useSearchStore.getState().closeQuickSearch();

        const liveNativeSession = await hasActiveNativePlaybackSession();
        if (!cancelled && snapshot?.playback && !liveNativeSession) {
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
        if (cancelled) return;

        const stableHref = validateSavedHref(snapshot?.lastStableHref ?? '/');
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
