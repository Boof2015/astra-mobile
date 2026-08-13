/* eslint-disable react-hooks/immutability -- Reanimated shared values are mutable press state. */
import { forwardRef, type ReactNode } from 'react';
import {
  type StyleProp,
  type View as NativeView,
  type ViewStyle,
} from 'react-native';
import {
  Pressable as GesturePressable,
  type PressableProps as GesturePressableProps,
} from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { playHaptic, type HapticEvent } from '@/lib/haptics';
import { motion } from '@/theme/motion';

const GesturePressableWithRef = forwardRef<NativeView, GesturePressableProps>(
  function GesturePressableWithRef(props, ref) {
    return <GesturePressable {...props} ref={ref} />;
  }
);
const AnimatedPressable = Animated.createAnimatedComponent(GesturePressableWithRef);

type HapticFeedback = HapticEvent | 'none';

interface TactilePressableProps
  extends Omit<GesturePressableProps, 'children' | 'style'> {
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

  const handlePressIn: NonNullable<GesturePressableProps['onPressIn']> = (event) => {
    scale.value = withTiming(pressedScale, motion.quick);
    onPressIn?.(event);
  };

  const handlePressOut: NonNullable<GesturePressableProps['onPressOut']> = (event) => {
    scale.value = withTiming(1, motion.quick);
    onPressOut?.(event);
  };

  const handlePress: NonNullable<GesturePressableProps['onPress']> = (event) => {
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
