import { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { resolveNotificationClick } from '@/audio/notificationIntent';
import { createThemedStyles } from '@/theme/themed';

export default function NotificationClickRoute() {
  const styles = useStyles();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    resolveNotificationClick()
      .then((href) => {
        if (!cancelled) router.replace(href);
      })
      .catch(() => {
        if (!cancelled) router.replace('/');
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return <View style={styles.root} />;
}

const useStyles = createThemedStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
}));
