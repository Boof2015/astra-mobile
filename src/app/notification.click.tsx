import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { getNotificationClickRedirectPath } from '@/audio/notificationIntent';
import { colors } from '@/theme';

export default function NotificationClickRoute() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    getNotificationClickRedirectPath()
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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
});
