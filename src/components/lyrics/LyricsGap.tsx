import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { lyricGapProgress } from '@/lyrics/animation';
import { useColors } from '@/theme/themed';

export function LyricsGap({ clock, start, end, past, width }: {
  clock?: SharedValue<number>; start: number; end: number | null; past: boolean; width: number;
}) {
  const colors = useColors();
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: clock ? lyricGapProgress(start, end, clock.value) : past ? 1 : 0 }] }));
  return <View accessibilityLabel="Instrumental" style={{ minHeight: 44, justifyContent: 'center' }}>
    <View style={{ width, height: 3, backgroundColor: colors.glassBorder, borderRadius: 2, overflow: 'hidden' }}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.textSecondary, transformOrigin: 'left center' }, fill]} />
    </View>
  </View>;
}
