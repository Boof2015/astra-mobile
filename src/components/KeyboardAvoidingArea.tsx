import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';

/**
 * Options every `useAnimatedKeyboard` subscriber must share. The app is
 * edge-to-edge, so Reanimated must not pad the window for the system bars
 * itself; with both flags on, the height it reports is the full IME inset,
 * navigation bar included.
 */
export const EDGE_TO_EDGE_KEYBOARD = {
  isStatusBarTranslucentAndroid: true,
  isNavigationBarTranslucentAndroid: true,
} as const;

/**
 * Drop-in for `KeyboardAvoidingView` on Android, where the app's edge-to-edge
 * window is never resized for the keyboard (the manifest's adjustResize is
 * ignored) and KeyboardAvoidingView with no behavior does nothing. Children are
 * laid out above a spacer that grows with the keyboard on the UI thread, so a
 * ScrollView child shrinks with it and Android keeps the focused field on
 * screen.
 *
 * `insetBelow` is whatever already sits between this area's bottom edge and
 * the bottom of the window. A root-stack Screen that bleeds past the navigation
 * bar runs to the window's edge, so it is 0 there.
 */
export function KeyboardAvoidingArea({
  style,
  insetBelow = 0,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  insetBelow?: number;
  children: ReactNode;
}) {
  if (Platform.OS !== 'android') {
    return (
      <KeyboardAvoidingView style={style} behavior="padding">
        {children}
      </KeyboardAvoidingView>
    );
  }
  return (
    <AndroidKeyboardArea style={style} insetBelow={insetBelow}>
      {children}
    </AndroidKeyboardArea>
  );
}

function AndroidKeyboardArea({
  style,
  insetBelow,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  insetBelow: number;
  children: ReactNode;
}) {
  const keyboard = useAnimatedKeyboard(EDGE_TO_EDGE_KEYBOARD);
  const spacerStyle = useAnimatedStyle(() => ({
    height: Math.max(0, keyboard.height.get() - insetBelow),
  }));
  return (
    <View style={style}>
      {children}
      <Animated.View style={spacerStyle} />
    </View>
  );
}
