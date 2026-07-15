import {
  isNotificationClickPath,
  resolveNotificationClick,
} from '@/audio/notificationIntent';
import { getEQPresetShareRedirectPath } from '@/audio/eqShareIntent';
import { getSignalShareRedirectPath } from '@/audio/signalShareIntent';

type RedirectSystemPathEvent = {
  path: string;
  initial: boolean;
};

export async function redirectSystemPath({ path }: RedirectSystemPathEvent): Promise<string> {
  if (isNotificationClickPath(path)) return resolveNotificationClick();

  const eqShareRedirect = getEQPresetShareRedirectPath(path);
  if (eqShareRedirect) return eqShareRedirect;

  const signalRedirect = getSignalShareRedirectPath(path);
  if (signalRedirect) return signalRedirect;

  return path;
}
