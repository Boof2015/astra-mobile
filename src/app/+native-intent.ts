import {
  getNotificationClickRedirectPath,
  isNotificationClickPath,
} from '@/audio/notificationIntent';

type RedirectSystemPathEvent = {
  path: string;
  initial: boolean;
};

export async function redirectSystemPath({ path }: RedirectSystemPathEvent): Promise<string> {
  if (!isNotificationClickPath(path)) return path;

  return getNotificationClickRedirectPath();
}
