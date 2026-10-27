import { View, type StyleProp, type TextStyle } from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable, SCROLL_PRESS_DELAY } from '@/components/AppPressable';

/**
 * The back chevron and the name of where it goes, as one control.
 *
 * Shared by the two collapsing headers (`ScreenHeader`, `CollapsingHeader`).
 * The label is part of the target and the same color as the chevron. They used
 * to be separate, so tapping "Library" did nothing.
 *
 * Every position is declared by the caller: the chevron box starts at
 * `chevronLeft`, and the gap is derived from `labelLeft`, so the label lands
 * exactly in the slot the collapsing title flies into.
 */
export function HeaderBackButton({
  onPress,
  top,
  height,
  chevronLeft,
  chevronSize,
  labelLeft,
  labelRight,
  label,
  labelFont,
  labelStyle,
  labelLive = true,
}: {
  onPress: () => void;
  /** The bar row the target fills: its top edge, inset included. */
  top: number;
  height: number;
  chevronLeft: number;
  chevronSize: number;
  /** Where the label text starts. */
  labelLeft: number;
  /** Right bound, so a long name ellipsizes clear of the bar's actions. */
  labelRight: number;
  label?: string;
  labelFont?: TextStyle;
  /** The header's scroll-driven fade. */
  labelStyle?: StyleProp<AnimatedStyle<TextStyle>>;
  /**
   * False once the label has faded out. It then leaves layout, so the target
   * shrinks back to the chevron instead of swallowing taps meant for the
   * collapsed bar's title and artwork.
   */
  labelLive?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View
      style={[styles.slot, { top, height, right: labelRight }]}
      pointerEvents="box-none"
    >
      <AppPressable
        feedback="control"
        unstable_pressDelay={SCROLL_PRESS_DELAY}
        onPress={onPress}
        style={[styles.button, { paddingLeft: chevronLeft }]}
        accessibilityRole="button"
        accessibilityLabel={label ? `Back to ${label}` : 'Back'}
      >
        <View style={[styles.chevron, { width: chevronSize, height: chevronSize }]}>
          <Ionicons name="chevron-back" size={chevronSize} color={colors.textPrimary} />
        </View>
        {label ? (
          <Animated.Text
            numberOfLines={1}
            style={[
              styles.label,
              labelFont,
              { marginLeft: labelLeft - chevronLeft - chevronSize },
              labelStyle,
              !labelLive && styles.gone,
            ]}
          >
            {label}
          </Animated.Text>
        ) : null}
      </AppPressable>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  slot: {
    position: 'absolute',
    left: 0,
    flexDirection: 'row',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    paddingRight: spacing.sm,
  },
  chevron: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flexShrink: 1,
    color: colors.textPrimary,
  },
  gone: {
    display: 'none',
  },
}));
