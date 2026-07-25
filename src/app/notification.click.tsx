import { useEffect } from 'react';
import { View } from 'react-native';
import { resolveNotificationClick } from '@/audio/notificationIntent';
import { useReturnToTabs } from '@/navigation/returnToTabs';
import { createThemedStyles } from '@/theme/themed';

export default function NotificationClickRoute() {
  const styles = useStyles();
  const returnToTabs = useReturnToTabs();

  // This route is a root-stack sibling of `(tabs)`, and it is entered often
  // (media-notification and widget taps). A bare replace toward a tab route
  // therefore left a duplicate `(tabs)` behind on every single tap.
  useEffect(() => {
    let cancelled = false;

    resolveNotificationClick()
      .then((href) => {
        if (!cancelled) returnToTabs(href);
      })
      .catch(() => {
        if (!cancelled) returnToTabs('/');
      });

    return () => {
      cancelled = true;
    };
  }, [returnToTabs]);

  return <View style={styles.root} />;
}

const useStyles = createThemedStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
}));
