import { useCallback } from 'react';
import { useNavigation, useRouter } from 'expo-router';
import {
  buildHomeLibraryResetAction,
  homeLibraryTargetHref,
  type HomeLibraryTarget,
  type NavigationStateLike,
} from '@/navigation/homeLibraryNavigation';

/**
 * Opens a Library detail as a fresh navigation context from Home.
 *
 * A malformed/unready tab state falls back to ordinary href navigation so a
 * state-shape mismatch never turns a content card into a dead control.
 */
export function useHomeLibraryNavigation(): (target: HomeLibraryTarget) => void {
  const navigation = useNavigation();
  const router = useRouter();

  return useCallback(
    (target: HomeLibraryTarget) => {
      const action = buildHomeLibraryResetAction(
        navigation.getState() as NavigationStateLike | undefined,
        target
      );
      if (!action) {
        router.push(homeLibraryTargetHref(target) as never, { withAnchor: true });
        return;
      }
      navigation.dispatch(action as never);
    },
    [navigation, router]
  );
}
