import { useEffect, useState } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  type LayoutChangeEvent
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
  colors,
  fonts,
  layout,
  spacing
} from '@/theme';
import { motion } from '@/theme/motion';
import { useDesktopRemoteStore } from '@/stores/desktopRemoteStore';
import { usePlaybackTargetStore } from '@/stores/playbackTargetStore';
import { usePlayerStore } from '@/stores/playerStore';

type IconName = keyof typeof Ionicons.glyphMap;
type MiniPlayerPhase = 'hidden' | 'reserved' | 'visible';

const TAB_TRANSITION_MS = 160;

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
}

/**
 * Astra bottom tab bar with the persistent mini-player glued above it.
 * Receives plain props (no react-navigation types) so the typed navigation
 * logic stays in the layout's `tabBar` callback.
 */
export function TabBar({ items, onPress }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const tabs = items.filter((item) => TAB_META[item.name]);
  const homeFocused = items.some((item) => item.name === 'index' && item.focused);
  const selectedTarget = usePlaybackTargetStore((s) => s.target);
  const phoneTrack = usePlayerStore((s) => s.currentTrack);
  const desktopConnection = useDesktopRemoteStore((s) => s.connection);
  const desktopTrack = useDesktopRemoteStore((s) => s.snapshot?.currentTrack);
  const [settledHomeFocused, setSettledHomeFocused] = useState(homeFocused);
  const count = tabs.length;
  const activeIndex = Math.max(
    0,
    tabs.findIndex((item) => item.focused),
  );

  // The "playhead": a single accent bar that glides along the top edge to the
  // active tab, travelling in the same direction as the scene transition.
  const barWidth = useSharedValue(0);
  const position = useSharedValue(activeIndex);

  useEffect(() => {
    position.value = withTiming(activeIndex, motion.snap);
  }, [activeIndex, position]);

  useEffect(() => {
    if (settledHomeFocused === homeFocused) {
      return;
    }

    const timer = setTimeout(() => setSettledHomeFocused(homeFocused), TAB_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [homeFocused, settledHomeFocused]);

  const remoteMiniVisibleOnHome =
    (selectedTarget === 'desktop' && Boolean(desktopConnection || desktopTrack)) ||
    (!phoneTrack && Boolean(desktopTrack));
  const suppressMiniForHome = homeFocused && !remoteMiniVisibleOnHome;
  const suppressMiniForSettledHome = settledHomeFocused && !remoteMiniVisibleOnHome;

  const miniPlayerPhase: MiniPlayerPhase = suppressMiniForHome
    ? suppressMiniForSettledHome
      ? 'hidden'
      : 'reserved'
    : suppressMiniForSettledHome
      ? 'hidden'
      : 'visible';

  const indicatorStyle = useAnimatedStyle(() => {
    const segment = count > 0 ? barWidth.value / count : 0;
    return {
      width: segment,
      transform: [{ translateX: position.value * segment }],
    };
  });

  const onBarLayout = (e: LayoutChangeEvent) => {
    barWidth.value = e.nativeEvent.layout.width;
  };

  return (
    <View style={styles.wrap}>
      {miniPlayerPhase === 'visible' ? <MiniPlayer /> : null}
      {miniPlayerPhase === 'reserved' ? <MiniPlayer visible={false} /> : null}
      <View
        style={[
          styles.bar,
          { paddingBottom: insets.bottom, height: layout.tabBarHeight + insets.bottom },
        ]}
        onLayout={onBarLayout}
      >
        <Animated.View style={[styles.indicator, indicatorStyle]} pointerEvents="none">
          <View style={styles.indicatorBar} />
        </Animated.View>
        {tabs.map((item) => {
          const meta = TAB_META[item.name];
          if (!meta) return null;
          return (
            <TabButton
              key={item.key}
              meta={meta}
              focused={item.focused}
              onPress={() => onPress(item)}
            />
          );
        })}
      </View>
    </View>
  );
}

interface TabButtonProps {
  meta: { label: string; icon: IconName };
  focused: boolean;
  onPress: () => void;
}

/**
 * A single tab. Selecting it cross-fades the icon/label colour to accent;
 * pressing depresses the icon for tactile feedback. Reanimated only drives
 * opacity/transform on plain Animated.Views — @expo/vector-icons' Icon is a
 * class-wrapped Text that Animated can't drive, so colour is a cross-fade
 * between a grey base icon and an accent one stacked on top. Spring-free per
 * theme/motion.
 */
function TabButton({ meta, focused, onPress }: TabButtonProps) {
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
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      progress.value,
      [0, 1],
      [colors.textTertiary, colors.accent],
    ),
  }));

  return (
    <Pressable
      style={styles.tab}
      onPress={onPress}
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

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.bgSecondary,
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.bgSecondary,
    borderTopColor: colors.glassBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  indicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    alignItems: 'center',
  },
  indicatorBar: {
    width: 28,
    height: 3,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.sm,
  },
  label: {
    marginTop: 2,
    fontSize: 10,
    fontFamily: fonts.sans.regular,
  },
});

export default TabBar;
