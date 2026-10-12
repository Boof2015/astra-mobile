import { useCallback } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { openPlayerFromNotification } from '@/audio/notificationIntent';
import { createThemedStyles } from '@/theme/themed';

export default function NotificationClickRoute() {
  const styles = useStyles();
  const router = useRouter();

  // Native taps are consumed before routing. If this fallback route is entered
  // directly, pop only this screen so the previous page and its history survive.
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    const dismissNotificationRoute = () => {
      if (cancelled) return;
      if (router.canGoBack()) router.back();
      else router.replace('/');
    };

    void openPlayerFromNotification().then(
      dismissNotificationRoute,
      dismissNotificationRoute,
    );

    return () => {
      cancelled = true;
    };
  }, [router]));

  return <View style={styles.root} />;
}

const useStyles = createThemedStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
}));
