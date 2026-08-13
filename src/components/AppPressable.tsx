import {
  Fragment,
  createContext,
  forwardRef,
  useContext,
  type PropsWithChildren,
} from 'react';
import {
  Pressable as NativePressable,
  StyleSheet,
  View,
  type PressableProps,
  type PressableStateCallbackType,
  type View as NativeView,
  type ViewStyle,
} from 'react-native';
import {
  Pressable as GesturePressable,
  type PressableProps as GesturePressableProps,
} from 'react-native-gesture-handler';
import { useColors } from '@/theme/themed';
import {
  composePressedStyle,
  resolveFeedbackCorners,
  resolvePressFeedback,
  type AppPressFeedback,
  type FeedbackCornerSource,
} from '@/components/appPressableFeedback';

/**
 * Delay used only inside scrollable content. A scroll gesture claims the touch
 * before feedback appears, while deliberate taps still receive press feedback.
 */
export const SCROLL_PRESS_DELAY = 80;

export interface AppPressableProps extends Omit<PressableProps, 'android_ripple'> {
  /** Astra's non-radial Android press treatment. */
  feedback?: AppPressFeedback;
  /** Overrides radii inferred from the root style for surface/tile washes. */
  feedbackRadius?: number;
}

const AppPressableGestureContext = createContext(false);

/**
 * Makes descendant AppPressables participate in Gesture Handler arbitration.
 * Gorhom sheets need this because their pan/scroll gestures can otherwise keep
 * winning contacts that React Native's responder-backed Pressable has claimed.
 */
export function AppPressableGestureScope({ children }: PropsWithChildren) {
  return (
    <AppPressableGestureContext.Provider value>
      {children}
    </AppPressableGestureContext.Provider>
  );
}

/**
 * The app-wide Android press surface. It preserves NativePressable semantics
 * while replacing the platform ripple with a restrained wash or opacity shift.
 */
export const AppPressable = forwardRef<NativeView, AppPressableProps>(
  function AppPressable(
    {
      feedback = 'surface',
      feedbackRadius,
      style,
      children,
      disabled = false,
      ...rest
    },
    ref,
  ) {
    const colors = useColors();
    const useGesturePressable = useContext(AppPressableGestureContext);
    const isDisabled = disabled === true;

    const resolveStyle = (state: PressableStateCallbackType) =>
      typeof style === 'function' ? style(state) : style;

    const pressableStyle = (state: PressableStateCallbackType) =>
      composePressedStyle(
        resolveStyle(state),
        resolvePressFeedback(feedback, state.pressed, isDisabled),
      );

    const pressableChildren = (state: PressableStateCallbackType) => {
      const content = typeof children === 'function' ? children(state) : children;
      const decision = resolvePressFeedback(feedback, state.pressed, isDisabled);
      if (!decision.overlay) return content;

      const flattened = StyleSheet.flatten(resolveStyle(state)) as
        | (ViewStyle & FeedbackCornerSource)
        | undefined;
      const wash = (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: colors.glassHighlight },
            resolveFeedbackCorners(flattened, feedbackRadius),
          ]}
        />
      );

      return decision.overlay === 'behind' ? (
        <Fragment>{wash}{content}</Fragment>
      ) : (
        <Fragment>{content}{wash}</Fragment>
      );
    };

    if (useGesturePressable) {
      const gestureProps = {
        ...rest,
        ref,
        disabled,
        style: pressableStyle,
        children: pressableChildren,
      } as unknown as GesturePressableProps;
      return <GesturePressable {...gestureProps} />;
    }

    return (
      <NativePressable
        {...rest}
        ref={ref}
        disabled={disabled}
        style={pressableStyle}
      >
        {pressableChildren}
      </NativePressable>
    );
  },
);
