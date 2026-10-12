import {
  isNotificationClickPath,
  openPlayerFromNotification,
} from '@/audio/notificationIntent';
import { getEQPresetShareRedirectPath } from '@/audio/eqShareIntent';
import { getSignalShareRedirectPath } from '@/audio/signalShareIntent';

type RedirectSystemPathEvent = {
  path: string;
  initial: boolean;
};

export async function redirectSystemPath({ path, initial }: RedirectSystemPathEvent): Promise<string | null> {
  if (isNotificationClickPath(path)) {
    await openPlayerFromNotification();
    // Only a fresh launch needs a destination. Returning null consumes a tap
    // in a running app without dispatching any navigation action underneath.
    return initial ? '/' : null;
  }

  const eqShareRedirect = getEQPresetShareRedirectPath(path);
  if (eqShareRedirect) return eqShareRedirect;

  const signalRedirect = getSignalShareRedirectPath(path);
  if (signalRedirect) return signalRedirect;

  return path;
}
