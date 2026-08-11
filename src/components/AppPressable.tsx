import { Fragment, forwardRef } from 'react';
import {
  Pressable as NativePressable,
  StyleSheet,
  View,
  type PressableProps,
  type PressableStateCallbackType,
  type View as NativeView,
  type ViewStyle,
} from 'react-native';
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
    const isDisabled = disabled === true;

    const resolveStyle = (state: PressableStateCallbackType) =>
      typeof style === 'function' ? style(state) : style;

    return (
      <NativePressable
        {...rest}
        ref={ref}
        disabled={disabled}
        style={(state) =>
          composePressedStyle(
            resolveStyle(state),
            resolvePressFeedback(feedback, state.pressed, isDisabled),
          )
        }
      >
        {(state) => {
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
        }}
      </NativePressable>
    );
  },
);
