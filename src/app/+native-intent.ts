import {
  isNotificationClickPath,
  resolveNotificationClick,
} from '@/audio/notificationIntent';
import { getEQPresetShareRedirectPath } from '@/audio/eqShareIntent';

type RedirectSystemPathEvent = {
  path: string;
  initial: boolean;
};

export async function redirectSystemPath({ path }: RedirectSystemPathEvent): Promise<string> {
  if (isNotificationClickPath(path)) return resolveNotificationClick();

  const eqShareRedirect = getEQPresetShareRedirectPath(path);
  if (eqShareRedirect) return eqShareRedirect;

  return path;
}
