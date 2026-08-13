/* eslint-disable react-hooks/immutability -- Reanimated shared values are the header's scroll state. */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  PixelRatio,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedReaction,
  useAnimatedStyle,
  runOnJS,
  useSharedValue,
  type ScrollHandlerProcessed,
  type SharedValue,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/Text';
import { useShellRailPresent } from '@/navigation/shellRailContext';
import { useShellLayout } from '@/navigation/useShellLayout';
import { MAX_FONT_SCALE, fontSize, radius, variantLineHeight } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable, SCROLL_PRESS_DELAY } from '@/components/AppPressable';
import {
  SCREEN_HEADER_ACTION_SIZE,
  SCREEN_HEADER_EXPANDED_ACTION_SIZE,
  compactActionsOpacityAt,
  compactActionsScaleAt,
  expandedActionsLiftAt,
  expandedActionsOpacityAt,
  barOpacityAt,
  getScreenHeaderLayout,
  headerHeightAt,
  labelOpacityAt,
  subtitleLiftAt,
  subtitleOpacityAt,
  titleLiftAt,
  titleScaleAt,
  titleSlideAt,
  type ScreenHeaderLayout,
} from '@/components/screenHeaderLayout';

/**
 * Material 3 collapsing page header: a large title that travels into a compact
 * top app bar as the page scrolls, and back out again at the top.
 *
 * The geometry is entirely declared — see `screenHeaderLayout.ts` for why, and
 * for the two shipped attempts that got this wrong. Two properties of this
 * component follow from that and should not be quietly undone:
 *
 * - **The list's top padding comes from `contentPaddingTop`, and nowhere else.**
 *   No consumer re-derives it, and nothing here measures it back.
 * - **React only hears about action handoff thresholds.** Motion stays on the
 *   UI thread; two latched booleans move pointer events from an optional large
 *   expanded action row to its compact bar icons.
 */

export interface ScreenHeaderController {
  scrollY: SharedValue<number>;
  onScroll: ScrollHandlerProcessed;
  scrollEventThrottle: 16;
  /** What the scroll surface owes as `contentContainerStyle.paddingTop`. */
  contentPaddingTop: number;
  layout: ScreenHeaderLayout;
  /**
   * Re-arm the header after a programmatic scroll.
   *
   * FlashList swallows the scroll events it causes itself (`ignoreScrollEvents`
   * short-circuits before the user's `onScroll` runs), so a scroll-to-top would
   * otherwise leave the header collapsed over an un-scrolled list.
   */
  resetScroll: () => void;
}

export function useScreenHeader({
  hasSubtitle = false,
  hasBack = true,
  actionCount = 0,
  hasExpandedActions = false,
  hasTitle = true,
  chromeHeight = 0,
}: {
  hasSubtitle?: boolean;
  hasBack?: boolean;
  actionCount?: number;
  /** Whether the expanded title reserves a standard labelled-action row. */
  hasExpandedActions?: boolean;
  /** False where the destination is already named elsewhere (Library + rail). */
  hasTitle?: boolean;
  /** Declared height of the pinned controls passed as `chrome`. */
  chromeHeight?: number;
}): ScreenHeaderController {
  const scrollY = useSharedValue(0);
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const railPresent = useShellRailPresent();
  const sceneInsetRight = useShellLayout().sceneInsetRight;

  // Mirror what `Screen` actually leaves for content: the rail pays the leading
  // inset when it is up, the player dock pays the trailing one. Measuring the
  // title against the raw window width would let it collide with the actions in
  // landscape or while docked.
  const availableWidth =
    window.width - (railPresent ? 0 : insets.left) - sceneInsetRight;

  const layout = getScreenHeaderLayout({
    availableWidth,
    windowHeight: window.height,
    topInset: insets.top,
    fontScale: PixelRatio.getFontScale(),
    hasSubtitle,
    hasBack,
    actionCount,
    hasExpandedActions,
    hasTitle,
    chromeHeight,
  });
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });
  const resetScroll = useCallback(() => {
    scrollY.value = 0;
  }, [scrollY]);

  return {
    scrollY,
    onScroll,
    scrollEventThrottle: 16 as const,
    contentPaddingTop: layout.contentPaddingTop,
    layout,
    resetScroll,
  };
}

export function ScreenHeader({
  header,
  title,
  subtitle,
  backLabel,
  onBack,
  actions,
  collapsedActions,
  expandedActions,
  chrome,
}: {
  header: ScreenHeaderController;
  title: string;
  subtitle?: string;
  /** Where back goes, shown beside the chevron until the title claims the row. */
  backLabel?: string;
  onBack?: () => void;
  /** Actions that stay in the bar in both expanded and collapsed states. */
  actions?: ReactNode;
  /** Compact counterparts to `expandedActions`, visible only after collapse. */
  collapsedActions?: ReactNode;
  /** Large labelled actions shown below the title while fully expanded. */
  expandedActions?: ReactNode;
  /**
   * Pinned controls below the title. Anchored to the container's bottom edge, so
   * they ride up as the title collapses and then stay put. Must be exactly
   * `chromeHeight` tall — pass that same number to `useScreenHeader`.
   */
  chrome?: ReactNode;
}) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { scrollY, layout } = header;

  // Capture numbers, not the layout object: the React Compiler cannot prove
  // `getScreenHeaderLayout` is pure, so `layout` is a fresh identity every
  // render, and Reanimated compares what the worklet captured.
  const { dist, settle, travelX, travelY, titleScale, maxHeight, minHeight } = layout;
  const handoffEnabled =
    layout.collapsible && expandedActions != null && collapsedActions != null;
  const interactionRef = useRef({ expanded: true, compact: false });
  const [interaction, setInteraction] = useState({ expanded: true, compact: false });
  const updateInteraction = useCallback((expanded: boolean, compact: boolean) => {
    if (
      interactionRef.current.expanded === expanded &&
      interactionRef.current.compact === compact
    ) return;
    interactionRef.current = { expanded, compact };
    setInteraction(interactionRef.current);
  }, []);

  useEffect(() => {
    if (!handoffEnabled) return;
    const y = scrollY.value;
    updateInteraction(
      expandedActionsOpacityAt(y, settle) > 0,
      compactActionsOpacityAt(y, settle) >= 0.5,
    );
  }, [handoffEnabled, scrollY, settle, updateInteraction]);

  useAnimatedReaction(
    () => {
      if (!handoffEnabled) return 0;
      const y = scrollY.value;
      return (
        (expandedActionsOpacityAt(y, settle) > 0 ? 1 : 0) |
        (compactActionsOpacityAt(y, settle) >= 0.5 ? 2 : 0)
      );
    },
    (flags, previous) => {
      if (flags === previous) return;
      runOnJS(updateInteraction)((flags & 1) !== 0, (flags & 2) !== 0);
    },
  );

  const collapseClipStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: headerHeightAt(scrollY.value, dist, maxHeight, minHeight) - maxHeight },
    ],
  }));
  const fixedContentStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: maxHeight - headerHeightAt(scrollY.value, dist, maxHeight, minHeight) },
    ],
  }));
  const titleStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: titleSlideAt(scrollY.value, settle, travelX) },
      { translateY: titleLiftAt(scrollY.value, settle, travelY) },
      { scale: titleScaleAt(scrollY.value, settle, titleScale) },
    ],
  }));
  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: subtitleOpacityAt(scrollY.value, settle),
    transform: [{ translateY: subtitleLiftAt(scrollY.value, settle) }],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: labelOpacityAt(scrollY.value, settle),
  }));
  const barStyle = useAnimatedStyle(() => ({
    opacity: barOpacityAt(scrollY.value, settle),
  }));
  const expandedActionsStyle = useAnimatedStyle(() => ({
    opacity: layout.collapsible
      ? expandedActionsOpacityAt(scrollY.value, settle)
      : 0,
    transform: [{
      translateY: layout.collapsible
        ? expandedActionsLiftAt(scrollY.value, settle)
        : 0,
    }],
  }));
  const compactActionsStyle = useAnimatedStyle(() => ({
    opacity: layout.collapsible
      ? compactActionsOpacityAt(scrollY.value, settle)
      : 1,
    transform: [{
      scale: layout.collapsible
        ? compactActionsScaleAt(scrollY.value, settle)
        : 1,
    }],
  }));

  // The title sizes itself rather than leaning on `Text`'s automatic scaling:
  // Android applies `maxFontSizeMultiplier` to fontSize but *not* to lineHeight
  // (TextAttributeProps.kt uses the uncapped one-arg toPixelFromSP for it), so
  // the real line box would outgrow the declared one and the title would miss
  // the bar centre it is flying to.
  const scale = Math.min(Math.max(PixelRatio.getFontScale(), 1), MAX_FONT_SCALE);
  const titleFont = {
    fontSize: fontSize.xxl * scale,
    lineHeight: layout.titleLine,
  };

  const chevron =
    onBack != null ? (
      <AppPressable feedback="control"

        unstable_pressDelay={SCROLL_PRESS_DELAY}
        onPress={onBack}
        hitSlop={12}
        style={[
          styles.chevron,
          {
            top: layout.barCenterY - layout.chevronSize / 2,
            left: layout.chevronLeft,
            width: layout.chevronSize,
            height: layout.chevronSize,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={layout.chevronSize} color={colors.textPrimary} />
      </AppPressable>
    ) : null;

  const actionCluster =
    actions != null || collapsedActions != null ? (
      <View
        style={[
          styles.actions,
          {
            top: layout.barCenterY - layout.actionSize / 2,
            right: layout.actionsRight,
            gap: layout.actionGap,
          },
        ]}
      >
        {collapsedActions != null ? (
          <Animated.View
            style={[styles.collapsedActions, { gap: layout.actionGap }, compactActionsStyle]}
            pointerEvents={
              handoffEnabled
                ? interaction.compact ? 'auto' : 'none'
                : 'auto'
            }
          >
            {collapsedActions}
          </Animated.View>
        ) : null}
        {actions}
      </View>
    ) : null;

  const expandedActionBlock =
    expandedActions != null && layout.collapsible ? (
      <Animated.View
        style={[
          styles.expandedActions,
          {
            top: insets.top + layout.expandedActionsTop,
            right: layout.actionsRight,
            width: layout.expandedActionsWidth,
            height: layout.expandedActionsHeight,
            gap: layout.actionGap,
          },
          expandedActionsStyle,
        ]}
        pointerEvents={interaction.expanded ? 'auto' : 'none'}
      >
        {expandedActions}
      </Animated.View>
    ) : null;

  // Anchored to the container's bottom edge, so the collapse carries it up and
  // it settles directly under the bar. Its height is declared, not measured —
  // the caller owes `chromeHeight` and an element that is exactly that tall.
  const chromeBlock =
    chrome != null ? (
      <View style={[styles.chrome, { height: layout.chromeHeight }]}>{chrome}</View>
    ) : null;

  // Two static cases share one tree: a window too short for a large title, and
  // a screen whose destination is already named elsewhere (no bar at all, just
  // chrome). Neither animates, so neither has to degrade gracefully at dist 0.
  if (!layout.collapsible) {
    return (
      <View
        style={[styles.container, styles.clipped, { height: minHeight }]}
        pointerEvents="box-none"
      >
        <View style={[styles.backdrop, styles.bar, { height: minHeight }]} pointerEvents="none" />
        {layout.hasTitle ? (
          <>
            <Text
              variant="heading"
              numberOfLines={1}
              style={[
                styles.barTitle,
                {
                  top: layout.barCenterY - layout.barHeight / 2,
                  height: layout.barHeight,
                  left: onBack != null ? layout.barTextLeft : layout.titleLeft,
                  right: layout.labelRight,
                },
              ]}
              pointerEvents="none"
            >
              {title}
            </Text>
            {chevron}
            {actionCluster}
          </>
        ) : null}
        {chromeBlock}
      </View>
    );
  }

  return (
    <View style={[styles.container, { height: maxHeight }]} pointerEvents="box-none">
      {/* The fixed-size clip translates upward so its bottom edge follows the
          collapsed height. Its ordinary header contents counter-translate and
          therefore remain visually fixed while being revealed by that edge.
          This preserves the old geometry without per-frame layout commits. */}
      <Animated.View
        style={[styles.collapseClip, collapseClipStyle]}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[styles.fixedContent, fixedContentStyle]}
          pointerEvents="box-none"
        >
          {/* Rows emerge at the translated clip's bottom edge with no seam. */}
          <View style={[styles.backdrop, { height: maxHeight }]} pointerEvents="none" />
          <Animated.View
            style={[styles.backdrop, styles.bar, { height: minHeight }, barStyle]}
            pointerEvents="none"
          />

          <Animated.View
            style={[
              styles.titleWrap,
              {
                top: insets.top + layout.titleTop,
                left: layout.titleLeft,
                right: layout.titleRight,
                height: layout.titleLine,
              },
              titleStyle,
            ]}
            pointerEvents="none"
          >
            <Text variant="title" numberOfLines={1} allowFontScaling={false} style={titleFont}>
              {title}
            </Text>
          </Animated.View>

          {subtitle ? (
            <Animated.View
              style={[
                styles.subtitle,
                {
                  top: insets.top + layout.subtitleTop,
                  left: layout.titleLeft,
                  right: layout.titleLeft,
                },
                subtitleStyle,
              ]}
              pointerEvents="none"
            >
              <Text variant="label" numberOfLines={1} allowFontScaling={false}>
                {subtitle}
              </Text>
            </Animated.View>
          ) : null}

          {backLabel ? (
            <Animated.Text
              numberOfLines={1}
              style={[
                styles.label,
                {
                  top: layout.barCenterY - variantLineHeight.label / 2,
                  left: layout.barTextLeft,
                  right: layout.labelRight,
                },
                labelStyle,
              ]}
              pointerEvents="none"
            >
              {backLabel}
            </Animated.Text>
          ) : null}

          {expandedActionBlock}

          {chevron}
          {actionCluster}
        </Animated.View>

        {/* Chrome stays attached to the moving bottom edge and settles directly
            below the app bar, so it intentionally is not counter-translated. */}
        {chromeBlock}
      </Animated.View>
    </View>
  );
}

/**
 * A compact button in the collapsed bar's action row.
 *
 * Sized from the same constant the layout proves the title cannot collide with,
 * so a screen can add actions without re-declaring the number that keeps them
 * apart. These never move or fade — they are pinned in the bar row from the
 * start — which is why the header needs no pointer-events handoff.
 */
export function ScreenHeaderAction({
  onPress,
  accessibilityLabel,
  children,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <AppPressable
      feedback="control"
      style={styles.action}
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </AppPressable>
  );
}

export function ScreenHeaderExpandedAction({
  onPress,
  accessibilityLabel,
  icon,
  variant = 'secondary',
}: {
  onPress: () => void;
  accessibilityLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
  variant?: 'primary' | 'secondary';
}) {
  const styles = useStyles();
  const colors = useColors();
  const primary = variant === 'primary';
  return (
    <AppPressable
      feedback={primary ? 'accent' : 'control'}
      unstable_pressDelay={SCROLL_PRESS_DELAY}
      style={[
        styles.expandedAction,
        primary ? styles.expandedActionPrimary : styles.expandedActionSecondary,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Ionicons
        name={icon}
        size={18}
        color={primary ? colors.bgPrimary : colors.accent}
      />
    </AppPressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  clipped: {
    overflow: 'hidden',
  },
  collapseClip: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  fixedContent: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.bgPrimary,
  },
  bar: {
    backgroundColor: colors.bgSecondary,
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleWrap: {
    position: 'absolute',
    justifyContent: 'center',
    // The travel scales about the leading edge, so the title grows out of and
    // shrinks back into the same x — a centre pivot would slide it sideways.
    transformOrigin: 'left center',
  },
  subtitle: {
    position: 'absolute',
  },
  barTitle: {
    position: 'absolute',
    textAlignVertical: 'center',
  },
  label: {
    position: 'absolute',
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: variantLineHeight.label,
  },
  chevron: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
  },
  collapsedActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  expandedActions: {
    position: 'absolute',
    flexDirection: 'row',
  },
  expandedAction: {
    width: SCREEN_HEADER_EXPANDED_ACTION_SIZE,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  expandedActionPrimary: {
    backgroundColor: colors.accent,
  },
  expandedActionSecondary: {
    backgroundColor: colors.glassBg,
    borderColor: colors.accent,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chrome: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
  },
  action: {
    width: SCREEN_HEADER_ACTION_SIZE,
    height: SCREEN_HEADER_ACTION_SIZE,
    borderRadius: SCREEN_HEADER_ACTION_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));

export default ScreenHeader;
