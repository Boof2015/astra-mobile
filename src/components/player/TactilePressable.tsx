/* eslint-disable react-hooks/immutability -- Reanimated shared values are mutable press state. */
import type { ReactNode } from 'react';
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { playHaptic, type HapticEvent } from '@/lib/haptics';
import { motion } from '@/theme/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type HapticFeedback = HapticEvent | 'none';

interface TactilePressableProps
  extends Omit<PressableProps, 'children' | 'style'> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  pressedScale?: number;
  confirmationScale?: number;
  haptic?: HapticFeedback;
}

/**
 * Now Playing press surface: restrained UI-thread compression plus one
 * best-effort haptic only after a press successfully commits.
 */
export function TactilePressable({
  children,
  style,
  pressedScale = 0.94,
  confirmationScale,
  haptic = 'none',
  disabled,
  onPress,
  onPressIn,
  onPressOut,
  ...rest
}: TactilePressableProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn: NonNullable<PressableProps['onPressIn']> = (event) => {
    scale.value = withTiming(pressedScale, motion.quick);
    onPressIn?.(event);
  };

  const handlePressOut: NonNullable<PressableProps['onPressOut']> = (event) => {
    scale.value = withTiming(1, motion.quick);
    onPressOut?.(event);
  };

  const handlePress: NonNullable<PressableProps['onPress']> = (event) => {
    if (haptic !== 'none') playHaptic(haptic);
    if (confirmationScale) {
      scale.value = withSequence(
        withTiming(confirmationScale, motion.quick),
        withTiming(1, motion.quick)
      );
    }
    onPress?.(event);
  };

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      style={[style, animatedStyle]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
    >
      {children}
    </AnimatedPressable>
  );
}
