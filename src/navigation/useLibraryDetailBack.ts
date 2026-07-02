import { useCallback } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

type LibraryDetailSource = 'home' | 'search';

function shouldReturnToLibraryRoot(from: string | string[] | undefined): from is LibraryDetailSource {
  return from === 'home' || from === 'search';
}

export function useLibraryDetailBack(from?: string | string[]) {
  const router = useRouter();
  const returnToLibraryRoot = shouldReturnToLibraryRoot(from);

  const handleBack = useCallback(() => {
    if (returnToLibraryRoot) {
      router.replace('/library');
      return;
    }
    router.back();
  }, [returnToLibraryRoot, router]);

  useFocusEffect(
    useCallback(() => {
      if (!returnToLibraryRoot) return;

      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        handleBack();
        return true;
      });

      return () => subscription.remove();
    }, [handleBack, returnToLibraryRoot])
  );

  return handleBack;
}
