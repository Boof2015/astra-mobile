import { Stack } from 'expo-router';
import {
  hasHomeLibraryHandoff,
  withoutHomeLibraryHandoff,
} from '@/navigation/homeLibraryNavigation';
import { useColors } from '@/theme/themed';

/**
 * Anchor the library stack at its list. Without this, navigating straight to a
 * detail route (from Home, quick search, or the now-playing overlay) builds a
 * stack of just `[album]` with nothing beneath it — so popping one level had
 * nowhere to go and back escaped the tab entirely.
 */
export const unstable_settings = {
  initialRouteName: 'index',
};

/**
 * Nested stack inside the Library tab so album/artist detail screens keep the
 * tab bar + mini-player visible.
 */
export default function LibraryLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={({ route }) => ({
        headerShown: false,
        contentStyle: { backgroundColor: colors.bgPrimary },
        // The tab cross-fade is the only transition needed for a Home handoff.
        // Suppressing the nested push prevents the replaced detail from being
        // visible underneath the incoming screen.
        animation: hasHomeLibraryHandoff(route.params) ? 'none' : undefined,
      })}
      screenListeners={({ route, navigation }) => ({
        transitionEnd: (event) => {
          if (event.data.closing || !hasHomeLibraryHandoff(route.params)) return;
          // Re-enable ordinary Library push/pop animations after this arrival.
          navigation.replaceParams(
            withoutHomeLibraryHandoff(route.params as Record<string, unknown> | undefined)
          );
        },
      })}
    />
  );
}
