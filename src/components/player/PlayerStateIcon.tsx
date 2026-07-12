import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { motion } from '@/theme/motion';

interface PlayerStateIconProps {
  selected: boolean;
  size: number;
  inactive: ReactNode;
  active: ReactNode;
}

/** Cross-fades transport/utility state without animating icon-font colour. */
export function PlayerStateIcon({
  selected,
  size,
  inactive,
  active,
}: PlayerStateIconProps) {
  const progress = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(selected ? 1 : 0, motion.quick);
  }, [progress, selected]);

  const inactiveStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
  }));
  const activeStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={inactiveStyle}>{inactive}</Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, activeStyle]}>
        {active}
      </Animated.View>
    </View>
  );
}
