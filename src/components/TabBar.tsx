import { useEffect } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  type LayoutChangeEvent
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeInRight,
  FadeOutRight,
  LinearTransition,
  ReduceMotion,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from 'react-native-reanimated';
import { MiniPlayer } from './MiniPlayer';
import { useSelectionSlide, type SelectionSlide } from './selectionSlide.ts';
import {
  fonts,
  layout,
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { motion } from '@/theme/motion';
import { playHaptic } from '@/lib/haptics';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  RAIL_SIDE_PADDING,
  SPLIT_BAR_MARGIN,
  SPLIT_CARD_PADDING,
  SPLIT_GAP,
  type ShellLayout,
} from '@/navigation/shellLayout';

/**
 * Layout animations only run on Animated components, and a nav item is a
 * Pressable. Without this the card's bounds travelled while the items inside
 * snapped to their new width — which is what made the icons look late.
 */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Shared by the nav card and its items, so they move as one object. */
const NAV_TRANSITION = LinearTransition.duration(motion.snap.duration).reduceMotion(
  ReduceMotion.System
);

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
  const split = shell.mode === 'split';

  // The mark follows the focused item's measured rect. It reads the same
  // `focused` flag the item colours itself from, so the two cannot point at
  // different tabs — and when nothing is focused there is deliberately no key to
  // follow rather than a fallback slot. The mode is its shape key: changing
  // shells invalidates every measurement at once, so the mark is re-placed from
  // the new ones without travelling. Rotating should find it already in
  // position, not watch it cross the screen diagonally.
  const slide = useSelectionSlide(
    tabs.find((item) => item.focused)?.key ?? null,
    rail ? 'vertical' : 'horizontal',
    shell.mode
  );

  const buttons = tabs.map((item) => {
    const meta = TAB_META[item.name];
    if (!meta) return null;
    return (
      <TabButton
        key={item.key}
        meta={meta}
        focused={item.focused}
        rail={rail}
        onLayout={slide.measure(item.key)}
        height={rail ? shell.navItemHeight : undefined}
        // Split items are sized by the shell rather than sharing the row
        // equally: the mini player takes the rest, and the leftover becomes the
        // gap between the two groups.
        width={split ? shell.splitBar.navItemWidth : undefined}
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
        <View style={styles.railNav}>
          <SelectionMark key={shell.mode} slide={slide} rail />
          {buttons}
        </View>
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

  if (split) {
    // Two peer cards floating over the scene, centred as a pair. Deliberately
    // NOT a chrome slab with a player sitting on it — nav and playback carry
    // the same surface here, which is what makes them read as one composed
    // control rather than two unrelated things sharing an edge.
    return (
      <View style={styles.wrap}>
        <View
          style={[
            styles.splitFloat,
            {
              paddingLeft: insets.left + SPLIT_BAR_MARGIN,
              paddingRight: insets.right + SPLIT_BAR_MARGIN,
              paddingBottom: insets.bottom + SPLIT_BAR_MARGIN,
              height: shell.splitBar.blockHeight + insets.bottom,
            },
          ]}
          pointerEvents="box-none"
        >
          {/* Glides to its new centre when the player card leaves, instead of
              being shoved there. Its position depends on whether it has a
              neighbour, so it has to move — the point is that it moves once,
              smoothly, rather than being pushed frame by frame. */}
          <Animated.View
            layout={NAV_TRANSITION}
            style={[
              styles.splitCard,
              { width: shell.splitBar.navWidth, height: shell.splitBar.height },
            ]}
          >
            {/* The mark is placed from the items' own measured offsets, so it
                has to share a box with them that adds no padding or border of
                its own — the card has both. */}
            <View style={styles.splitRow}>
              <SelectionMark key={shell.mode} slide={slide} />
              {buttons}
            </View>
          </Animated.View>
          {/* Docked, the player card IS the pane — showing both would be the
              same track twice. It collapses its own width rather than
              vanishing, and because the row is centred the nav card slides
              across to fill the space as a consequence. Same driver as the
              pane's reveal, opposite direction. */}
          <SplitPlayerCard shell={shell} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {/* Out of the layout flow, sitting on top of the scene rather than
          beside it. In flow, this element's height was subtracted from the
          scene, so content stopped in a band above the pill and it read as a
          slab of chrome no matter what colour it was painted. Scrollable
          content reserves `shell.sceneBottomInset` at its bottom to clear it. */}
      {/* Docked, the dock is the player, so the pill would be the same track
          twice — and `sceneBottomInset` is 0 to match, because nothing floats. */}
      {shell.docked ? null : (
        <View style={styles.floatingPlayer} pointerEvents="box-none">
          <MiniPlayer />
        </View>
      )}
      <View
        style={[
          styles.bar,
          { paddingBottom: insets.bottom, height: layout.tabBarHeight + insets.bottom },
        ]}
      >
        <SelectionMark key={shell.mode} slide={slide} />
        {buttons}
      </View>
    </View>
  );
}

/**
 * The split bar's player card, which leaves toward the pane it is becoming.
 *
 * It used to collapse its own width, which kept it in the layout for the whole
 * exit and shoved the nav card along frame by frame. Now it drops out of layout
 * immediately and fades out *rightward* on top — so the nav card makes exactly
 * one move, and the card exits in the direction the pane arrives from.
 *
 * The exit is deliberately quicker than the entrance: the bar should settle
 * before the pane finishes sliding in, not compete with it.
 */
function SplitPlayerCard({ shell }: { shell: ShellLayout }) {
  if (shell.docked) return null;

  return (
    <Animated.View
      // Waits for the nav card to finish travelling before appearing. Entering
      // alongside it put the card on top of a nav card that was still moving —
      // the return has to read as a sequence, not a pile-up.
      entering={FadeInRight.duration(motion.quick.duration)
        .delay(motion.quick.duration)
        .reduceMotion(ReduceMotion.System)}
      exiting={FadeOutRight.duration(motion.quick.duration).reduceMotion(
        ReduceMotion.System
      )}
    >
      <MiniPlayer
        variant="bar"
        barLayout={shell.splitBar}
        onExpandToDock={
          shell.dockAllowed
            ? () => void useSettingsStore.getState().setPlayerDockOpen(true)
            : undefined
        }
      />
    </Animated.View>
  );
}

/**
 * The accent mark, sliding to whichever destination is selected.
 *
 * It is a sibling of the nav items rather than a child of the focused one, which
 * is the only way it can travel — but that means it has to be positioned rather
 * than placed, and positioning it by *counting slots* is what made the previous
 * one land on the wrong tab. It follows measured rects instead; see
 * `selectionSlideMath`.
 *
 * Mount this with `key={shell.mode}`: the two axes animate different style
 * properties, so the worklet has to be rebuilt when the shell changes shape
 * instead of carrying a width into a rail that has no use for one.
 */
function SelectionMark({ slide, rail = false }: { slide: SelectionSlide; rail?: boolean }) {
  const styles = useStyles();
  const { offset, extent, presence } = slide;
  const markStyle = useAnimatedStyle(() =>
    rail
      ? {
          opacity: presence.value,
          height: extent.value,
          transform: [{ translateY: offset.value }],
        }
      : {
          opacity: presence.value,
          width: extent.value,
          transform: [{ translateX: offset.value }],
        }
  );

  return (
    <Animated.View
      style={[rail ? styles.railIndicator : styles.indicator, markStyle]}
      pointerEvents="none"
    >
      <View style={rail ? styles.railIndicatorBar : styles.indicatorBar} />
    </Animated.View>
  );
}

interface TabButtonProps {
  meta: { label: string; icon: IconName };
  focused: boolean;
  onPress: () => void;
  /** Reports this item's box so the shared mark can travel to it. */
  onLayout: (event: LayoutChangeEvent) => void;
  /** Rail items are fixed-height and mark selection on their leading edge. */
  rail?: boolean;
  height?: number;
  /** Split-bar items are shell-sized rather than sharing the row equally. */
  width?: number;
}

/**
 * A single tab. Selecting it cross-fades the icon/label colour to accent;
 * pressing depresses the icon for tactile feedback. Reanimated only drives
 * opacity/transform on plain Animated.Views — @expo/vector-icons' Icon is a
 * class-wrapped Text that Animated can't drive, so colour is a cross-fade
 * between a grey base icon and an accent one stacked on top. Spring-free per
 * theme/motion.
 *
 * It does not draw the selection mark: a mark that belongs to the focused item
 * can only appear and disappear, never travel. It reports its box instead, and
 * `SelectionMark` slides to it.
 */
function TabButton({
  meta,
  focused,
  onPress,
  onLayout,
  rail = false,
  height,
  width,
}: TabButtonProps) {
  const styles = useStyles();
  const colors = useColors();
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
    <AnimatedPressable
      // Same transition as the card around it, so a resize is one movement
      // rather than a container gliding over children that jumped.
      layout={width ? NAV_TRANSITION : undefined}

      style={[
        styles.tab,
        rail && styles.railTab,
        width ? styles.splitTab : null,
        height ? { height } : null,
        width ? { width } : null,
      ]}
      onPress={handlePress}
      onLayout={onLayout}
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
    </AnimatedPressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  // Deliberately unpainted, and sized by the bar alone. Only the bar is chrome.
  wrap: {},
  floatingPlayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Directly above this element's top edge, i.e. over the scene.
    bottom: '100%',
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.bgSecondary,
    borderTopColor: colors.glassBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  // Out of the layout flow like the pill, anchored to the bottom of the scene.
  // Centred rather than `space-between`: the shell already divided the row, so
  // any slack means both cards are at their caps, and a centred pair looks
  // composed where opposite edges look like two things that drifted apart.
  splitFloat: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: SPLIT_GAP,
  },
  // Same surface as the mini-player card it sits beside. That equivalence is
  // the point — see the split branch above.
  splitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    // Vertical padding as well as horizontal: the card clips to its rounded
    // edge, so the selection indicator has to sit inside this inset rather than
    // flush to the card's top, where it was being shaved off.
    padding: SPLIT_CARD_PADDING,
    borderRadius: radius.lg,
    backgroundColor: colors.bgTertiary,
    borderColor: colors.glassBorderStrong,
    borderWidth: 1,
    overflow: 'hidden',
  },
  // The card's padded interior as its own box, so the mark and the items it
  // measures share one coordinate space. Measured offsets count from the card's
  // border, an absolute child counts from inside it, and the difference would be
  // a permanent 1dp lean.
  // `alignSelf` because the card centres its children: without it this row would
  // shrink to its content and take the items — which stretch to *it* — with it,
  // dropping them off the card's padded top edge along with the mark.
  splitRow: {
    flex: 1,
    alignSelf: 'stretch',
    flexDirection: 'row',
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
  // Width and offset come from the focused item's measurement, so the mark is
  // exactly as wide as the tab it marks whether the row divides evenly (a
  // phone's bar) or not (a split card mid-resize). The 28dp bar centres in it.
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
  // The rail's selection mark reads down the leading edge rather than across
  // the top, so it points along the rail's own axis — and takes its height from
  // the item rather than a `bottom` anchor, so it can travel between them.
  railIndicator: {
    position: 'absolute',
    top: 0,
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
  // Sized by the shell, so it must not also try to share the row.
  // Fills the card's padded box, so the indicator anchors to a known edge that
  // is `SPLIT_CARD_PADDING` inside the card rather than on its clipped border.
  splitTab: {
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
