import { Stack } from 'expo-router';
import { colors } from '@/theme';

/**
 * Nested stack inside the Library tab so album/artist detail screens keep the
 * tab bar + mini-player visible.
 */
export default function LibraryLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bgPrimary },
      }}
    />
  );
}
