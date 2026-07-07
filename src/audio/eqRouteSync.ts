import { AstraAudioRoute } from '../../modules/astra-audio-route';
import { useEQStore } from '@/stores/eqStore';

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
