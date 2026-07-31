import { useEffect } from 'react';
import {
  View,
  Pressable,
  StyleSheet
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from 'react-native-reanimated';
import { MiniPlayer } from './MiniPlayer';
import {
  fonts,
  layout,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import { motion } from '@/theme/motion';
import { playHaptic } from '@/lib/haptics';
import { RAIL_SIDE_PADDING, type ShellLayout } from '@/navigation/shellLayout';

type IconName = keyof typeof Ionicons.glyphMap;

export const TAB_META: Record<string, { label: string; icon: IconName }> = {
  index: { label: 'Home', icon: 'home' },
  library: { label: 'Library', icon: 'musical-notes' },
  eq: { label: 'EQ', icon: 'options' },
  settings: { label: 'Settings', icon: 'settings' },
};

export interface TabItem {
  key: string;
  name: string;
  focused: boolean;
}

interface TabBarProps {
  items: TabItem[];
  onPress: (item: TabItem) => void;
  shell: ShellLayout;
}

/**
 * Astra navigation chrome with the persistent mini-player attached.
 *
 * Portrait renders a bottom bar with the mini-player pill above it; landscape
 * renders a vertical rail with the mini player docked at its foot, because that
 * chrome costs a ~411dp-tall window 152dp it cannot spare. Both shapes share
 * every destination, the haptics and the selection animation — only the
 * arrangement differs.
 *
 * Receives plain props (no react-navigation types) so the typed navigation
 * logic stays in the layout's `tabBar` callback.
 */
export function TabBar({ items, onPress, shell }: TabBarProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const tabs = items.filter((item) => TAB_META[item.name]);
  const rail = shell.mode === 'rail';

  const buttons = tabs.map((item) => {
    const meta = TAB_META[item.name];
    if (!meta) return null;
    return (
      <TabButton
        key={item.key}
        meta={meta}
        focused={item.focused}
        rail={rail}
        height={rail ? shell.navItemHeight : undefined}
        onPress={() => onPress(item)}
      />
    );
  });

  if (rail) {
    return (
      <View
        style={[
          styles.rail,
          {
            width: shell.railWidth,
            paddingLeft: insets.left + RAIL_SIDE_PADDING,
            paddingRight: RAIL_SIDE_PADDING,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          },
        ]}
      >
        <View style={styles.railNav}>{buttons}</View>
        {/* Wrapped so the rail has exactly one flexible child. MiniPlayer also
            renders a PlaybackTargetPicker Modal as a sibling, and a bare
            justifyContent here would have treated that as a third item and
            stranded the player in the middle of the rail. */}
        <View style={styles.railFoot}>
          <MiniPlayer variant="rail" railLayout={shell.miniPlayer} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <MiniPlayer />
      <View
        style={[
          styles.bar,
          { paddingBottom: insets.bottom, height: layout.tabBarHeight + insets.bottom },
        ]}
      >
        {buttons}
      </View>
    </View>
  );
}

interface TabButtonProps {
  meta: { label: string; icon: IconName };
  focused: boolean;
  onPress: () => void;
  /** Rail items are fixed-height and mark selection on their leading edge. */
  rail?: boolean;
  height?: number;
}

/**
 * A single tab. Selecting it cross-fades the icon/label colour to accent;
 * pressing depresses the icon for tactile feedback. Reanimated only drives
 * opacity/transform on plain Animated.Views — @expo/vector-icons' Icon is a
 * class-wrapped Text that Animated can't drive, so colour is a cross-fade
 * between a grey base icon and an accent one stacked on top. Spring-free per
 * theme/motion.
 */
function TabButton({ meta, focused, onPress, rail = false, height }: TabButtonProps) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  // 0 = inactive, 1 = active. Drives the accent fill, label colour, and bloom.
  const progress = useSharedValue(focused ? 1 : 0);
  // 0 = at rest, 1 = finger down.
  const press = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(focused ? 1 : 0, motion.quick);
  }, [focused, progress]);

  const depressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - press.value * 0.12 }],
  }));
  const accentStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  // Locals so the worklet captures plain strings: a theme switch re-renders,
  // the captured values change, and Reanimated rebuilds the worklet.
  const inactiveColor = colors.textTertiary;
  const activeColor = colors.accent;
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [inactiveColor, activeColor]),
  }));

  const handlePress = () => {
    if (!focused) playHaptic('selection');
    onPress();
  };

  return (
    <Pressable
      android_ripple={ripple.icon(26)}
      style={[styles.tab, rail && styles.railTab, height ? { height } : null]}
      onPress={handlePress}
      onPressIn={() => {
        press.value = withTiming(1, motion.quick);
      }}
      onPressOut={() => {
        press.value = withTiming(0, motion.quick);
      }}
      hitSlop={8}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
    >
      {focused ? (
        <View
          style={rail ? styles.railIndicator : styles.indicator}
          pointerEvents="none"
        >
          <View style={rail ? styles.railIndicatorBar : styles.indicatorBar} />
        </View>
      ) : null}
      <Animated.View style={depressStyle}>
        <Ionicons name={meta.icon} size={22} color={colors.textTertiary} />
        <Animated.View style={[StyleSheet.absoluteFill, accentStyle]}>
          <Ionicons name={meta.icon} size={22} color={colors.accent} />
        </Animated.View>
      </Animated.View>
      <Animated.Text style={[styles.label, labelStyle]}>{meta.label}</Animated.Text>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  wrap: {
    backgroundColor: colors.bgSecondary,
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.bgSecondary,
    borderTopColor: colors.glassBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  // Landscape rail: destinations at the top, mini player pushed to the foot by
  // `railFoot`'s auto margin. `getShellLayout` guarantees both fit.
  rail: {
    backgroundColor: colors.bgSecondary,
    borderRightColor: colors.glassBorder,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  railNav: {
    flexGrow: 0,
  },
  railFoot: {
    marginTop: 'auto',
  },
  indicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  indicatorBar: {
    width: 28,
    height: 3,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  // The rail's selection mark reads down the leading edge rather than across
  // the top, so it points along the rail's own axis.
  railIndicator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'center',
  },
  railIndicatorBar: {
    width: 3,
    height: 24,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.sm,
  },
  railTab: {
    flex: 0,
    alignSelf: 'stretch',
    paddingTop: 0,
  },
  label: {
    marginTop: 2,
    fontSize: 10,
    fontFamily: fonts.sans.regular,
  },
}));

export default TabBar;
