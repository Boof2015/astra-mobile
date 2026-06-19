import { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import type { TextLayoutEvent } from 'react-native/Libraries/Types/CoreEventTypes';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Text } from './Text';

type TextVariant = 'title' | 'heading' | 'body' | 'label' | 'caption' | 'mono';

const DEFAULT_DELAY_MS = 900;
const DEFAULT_HOLD_MS = 900;
const DEFAULT_SPEED_PX_PER_SECOND = 28;
const MIN_DURATION_MS = 1600;
const MEASURE_WIDTH = 10000;

interface MarqueeTextProps {
  children: string;
  variant?: TextVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  delayMs?: number;
  holdMs?: number;
  speedPxPerSecond?: number;
}

export function MarqueeText({
  children,
  variant = 'body',
  color,
  style,
  containerStyle,
  delayMs = DEFAULT_DELAY_MS,
  holdMs = DEFAULT_HOLD_MS,
  speedPxPerSecond = DEFAULT_SPEED_PX_PER_SECOND,
}: MarqueeTextProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const offset = useSharedValue(0);
  const overflowDistance = Math.max(0, Math.ceil(textWidth - containerWidth));

  useEffect(() => {
    cancelAnimation(offset);
    offset.value = 0;

    if (overflowDistance <= 1) return;

    const duration = Math.max(
      MIN_DURATION_MS,
      Math.round((overflowDistance / speedPxPerSecond) * 1000)
    );
    offset.value = withDelay(
      delayMs,
      withRepeat(
        withSequence(
          withTiming(-overflowDistance, { duration, easing: Easing.linear }),
          withDelay(holdMs, withTiming(-overflowDistance, { duration: 0 })),
          withTiming(0, { duration, easing: Easing.linear }),
          withDelay(holdMs, withTiming(0, { duration: 0 }))
        ),
        -1,
        false
      )
    );
  }, [delayMs, holdMs, offset, overflowDistance, speedPxPerSecond]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  const handleContainerLayout = (event: LayoutChangeEvent) => {
    setContainerWidth(event.nativeEvent.layout.width);
  };

  const handleTextLayout = (event: TextLayoutEvent) => {
    const measuredWidth = Math.ceil(event.nativeEvent.lines[0]?.width ?? 0);
    setTextWidth((current) => (Math.abs(current - measuredWidth) > 1 ? measuredWidth : current));
  };

  return (
    <View style={[styles.container, containerStyle]} onLayout={handleContainerLayout}>
      <Animated.View
        style={[styles.content, textWidth > 0 ? { width: textWidth } : null, animatedStyle]}
      >
        <Text
          variant={variant}
          color={color}
          numberOfLines={1}
          ellipsizeMode="clip"
          style={style}
        >
          {children}
        </Text>
      </Animated.View>
      <Text
        variant={variant}
        color={color}
        numberOfLines={1}
        onTextLayout={handleTextLayout}
        style={[styles.measure, style]}
      >
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  content: {
    alignSelf: 'flex-start',
  },
  measure: {
    position: 'absolute',
    width: MEASURE_WIDTH,
    opacity: 0,
  },
});

export default MarqueeText;
