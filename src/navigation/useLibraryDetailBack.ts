import { useCallback } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

export function useLibraryDetailBack() {
  const router = useRouter();

  const handleBack = useCallback(() => {
    router.dismissTo('/library');
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        handleBack();
        return true;
      });

      return () => subscription.remove();
    }, [handleBack])
  );

  return handleBack;
}
