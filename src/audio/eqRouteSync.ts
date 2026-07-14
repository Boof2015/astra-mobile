import {
  AstraAudioRoute,
  isAstraAudioRouteAvailable,
} from '../../modules/astra-audio-route';
import { useEQStore } from '@/stores/eqStore';
import type { AudioOutputRoute } from '@/types/audio';
import { isAudioOutputRouteUsable } from '@/audio/eqRouteProfiles';

type Subscription = { remove: () => void };

let startPromise: Promise<void> | null = null;
let subscription: Subscription | null = null;

async function applyCurrentRoute(): Promise<void> {
  try {
    await useEQStore.getState().setOutputRoute(AstraAudioRoute.getCurrentRoute());
  } catch (error) {
    console.warn('[eq-route] apply failed', error);
  }
}

/**
 * Strict one-shot refresh for the guarded play path. The normal listener is
 * defensive; this version must surface missing native routing or a failed EQ
 * profile restore so playback can remain paused.
 */
export async function refreshEQRouteForPlayback(): Promise<AudioOutputRoute> {
  if (!isAstraAudioRouteAvailable) {
    throw new Error('Native audio-route module unavailable');
  }
  await useEQStore.getState().load();
  const route = AstraAudioRoute.getCurrentRoute();
  if (!route) throw new Error('Current media output route unavailable');
  if (!isAudioOutputRouteUsable(route)) {
    throw new Error('Current media output route unresolved');
  }
  if (route.kind === 'unknown') {
    // A real but newer Android route type is still safe: retain/reassert the
    // loaded EQ state instead of permanently blocking playback. Android Auto
    // used to reach this path because TYPE_REMOTE_SUBMIX was not classified.
    console.warn('[eq-route] unclassified native output; retaining current EQ', {
      nativeType: route.nativeType,
      nativeId: route.nativeId,
      label: route.label,
    });
  }
  await useEQStore.getState().setOutputRoute(route);
  return route;
}

async function startEQRouteSync(): Promise<void> {
  if (!subscription) {
    subscription = AstraAudioRoute.addListener('onAudioRouteChanged', (route) => {
      void useEQStore.getState().setOutputRoute(route).catch((error) => {
        console.warn('[eq-route] route change failed', error);
      });
    });
  }

  await useEQStore.getState().load();

  try {
    AstraAudioRoute.start();
  } catch (error) {
    console.warn('[eq-route] native start failed', error);
  }

  await applyCurrentRoute();
}

export function ensureEQRouteSyncStarted(): Promise<void> {
  if (!startPromise) {
    startPromise = startEQRouteSync().catch((error) => {
      startPromise = null;
      throw error;
    });
  }
  return startPromise;
}

export function stopEQRouteSync(): void {
  subscription?.remove();
  subscription = null;
  startPromise = null;
  try {
    AstraAudioRoute.stop();
  } catch {
    /* no-op */
  }
}
