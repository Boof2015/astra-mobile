import { Stack } from 'expo-router';
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
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bgPrimary },
      }}
    />
  );
}
