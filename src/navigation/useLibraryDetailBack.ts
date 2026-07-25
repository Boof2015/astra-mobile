import { useCallback, useMemo } from 'react';
import { useNavigation, useRouter } from 'expo-router';
import {
  canPopWithinLibrary,
  libraryParentLabel,
  parentRoute,
  type StackStateLike,
} from '@/navigation/libraryDetailBack';

export interface LibraryDetailBack {
  /** Pops one level, so artist → album → back returns to the artist. */
  goBack: () => void;
  /** Names what `goBack` will actually return to (see libraryParentLabel). */
  backLabel: string;
}

/**
 * Back behaviour for the library detail screens.
 *
 * No hardware-back interception any more: the old handler always returned true
 * and redirected to the library root, which meant the Android button could never
 * pop normally. Letting the stack handle it natively is both simpler and what
 * users expect. A deep chain is escaped in one tap by re-pressing the Library
 * tab (see `src/app/(tabs)/_layout.tsx`), not by flattening every back press.
 */
export function useLibraryDetailBack(): LibraryDetailBack {
  const router = useRouter();
  const navigation = useNavigation();

  // The route beneath this one cannot change while the screen stays mounted, so
  // a one-shot read is enough — no reactive subscription needed.
  const { parent, canPop } = useMemo(() => {
    const state = navigation.getState() as StackStateLike | undefined;
    return { parent: parentRoute(state), canPop: canPopWithinLibrary(state) };
  }, [navigation]);

  const goBack = useCallback(() => {
    if (canPop) {
      router.back();
      return;
    }
    // Nothing beneath us: the stack was entered straight at a detail screen.
    router.dismissTo('/library');
  }, [canPop, router]);

  return { goBack, backLabel: libraryParentLabel(parent) };
}
