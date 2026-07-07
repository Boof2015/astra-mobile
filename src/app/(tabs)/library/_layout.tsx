import { Stack } from 'expo-router';
import { useColors } from '@/theme/themed';

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
