/* eslint-disable react-hooks/immutability -- Reanimated shared values are the header's UI-thread scroll state. */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react';
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue
} from 'react-native-reanimated';
import {
  Canvas,
  LinearGradient,
  Rect,
  vec
} from '@shopify/react-native-skia';
import { Text } from '@/components/Text';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable, SCROLL_PRESS_DELAY } from '@/components/AppPressable';
import {
  DETAIL_ART_COLLAPSED,
  DETAIL_BAR_H,
  getDetailExpandedHeight,
  getDetailHeroLayout,
} from '@/components/library/detailHeroLayout';

// Collapsing detail header. A fixed-size clipping layer translates upward with
// the scroll while its contents counter-translate, producing a rising bottom
// edge without animating layout. The artwork is a single element that
// shrinks/tucks into the top-left corner as the header collapses.
//
// Hero geometry — artwork size/position, where the title block goes, and the
// ceiling that keeps the list reachable — lives in ./detailHeroLayout so it can
// be tested without a renderer. See the note there about landscape.
const ART_COLLAPSED = DETAIL_ART_COLLAPSED;
const BAR_H = DETAIL_BAR_H;
const FADE_H = 150;

/**
 * Scroll plumbing. Measures the hero block so the header height (and thus the
 * collapse distance and the list's top padding) adapt to the title length —
 * long titles don't clip the buttons. `heroFaded` disables the big (now-invisible)
 * buttons before `collapsed` enables the header's icon buttons, so neither steals
 * taps mid-transition.
 */
export function useDetailCollapse() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const hero = getDetailHeroLayout(width, height, insets.top);
  const fallback = Math.min(hero.fallbackExpandedHeight, hero.maxExpandedHeight);
  const scrollY = useSharedValue(0);
  // The measurement carries the orientation it was taken in. Rotating reshapes
  // the hero underneath it, and a portrait measurement applied to a landscape
  // window is taller than the window itself — so a mismatched one is ignored in
  // favour of the fallback rather than kept until the next layout pass.
  const [measured, setMeasured] = useState<{ wide: boolean; height: number } | null>(
    null
  );
  const expandedHeight = Math.min(
    measured && measured.wide === hero.wide ? measured.height : fallback,
    hero.maxExpandedHeight
  );
  const ref = useRef({ heroFaded: false, collapsed: false });
  const [state, setState] = useState({ heroFaded: false, collapsed: false });
  const collapseDistance = useSharedValue(expandedHeight - BAR_H);
  const collapseFlags = useSharedValue(0);

  const updateCollapseState = useCallback((heroFaded: boolean, collapsed: boolean) => {
    if (heroFaded === ref.current.heroFaded && collapsed === ref.current.collapsed) return;
    ref.current = { heroFaded, collapsed };
    setState({ heroFaded, collapsed });
  }, []);

  // Measurements and rotations are rare JS-side events. Keep the worklet's
  // threshold current without routing any per-frame scroll values through JS.
  useEffect(() => {
    const dist = expandedHeight - BAR_H;
    collapseDistance.value = dist;
    const y = scrollY.value;
    const flags = (y >= 60 ? 1 : 0) | (y >= dist - 40 ? 2 : 0);
    collapseFlags.value = flags;
    updateCollapseState((flags & 1) !== 0, (flags & 2) !== 0);
  }, [collapseDistance, collapseFlags, expandedHeight, scrollY, updateCollapseState]);

  const onHeroBlockLayout = (e: LayoutChangeEvent) => {
    const next = getDetailExpandedHeight(hero, e.nativeEvent.layout.height);
    setMeasured((prev) =>
      prev && prev.wide === hero.wide && Math.abs(prev.height - next) <= 1
        ? prev
        : { wide: hero.wide, height: next }
    );
  };

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      const y = event.contentOffset.y;
      const dist = collapseDistance.value;
      const flags = (y >= 60 ? 1 : 0) | (y >= dist - 40 ? 2 : 0);

      // This is the animation's source of truth and now stays on the UI thread.
      // React only hears about the two pointer-event handoff thresholds.
      scrollY.value = y;
      if (flags !== collapseFlags.value) {
        collapseFlags.value = flags;
        runOnJS(updateCollapseState)((flags & 1) !== 0, (flags & 2) !== 0);
      }
    },
  });

  return {
    scrollY,
    ...state,
    expandedHeight,
    onHeroBlockLayout,
    onScroll,
    scrollEventThrottle: 16 as const,
  };
}

function BottomFade() {
  const styles = useStyles();
  const colors = useColors();
  const [width, setWidth] = useState(0);
  return (
    <View style={styles.fade} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Rect x={0} y={0} width={width} height={FADE_H}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(0, FADE_H)}
              colors={[`${colors.bgPrimary}00`, colors.bgPrimary]}
            />
          </Rect>
        </Canvas>
      ) : null}
    </View>
  );
}

export function CollapsingHeader({
  artwork,
  backdropUri,
  title,
  heroMeta,
  heroExtra,
  disabled,
  onBack,
  backLabel,
  onMore,
  moreAccessibilityLabel = 'More options',
  onPlay,
  onShuffle,
  scrollY,
  heroFaded,
  collapsed,
  expandedHeight,
  onHeroBlockLayout,
}: {
  /** Fills the morphing art container (album cover, artist mosaic, or fallback). */
  artwork: ReactNode;
  backdropUri: string | null;
  title: string;
  /** The middle of the hero block, between title and buttons (subtitle/meta or stat chips). */
  heroMeta: ReactNode;
  /** Optional compact control below meta, before the Play / Shuffle buttons. */
  heroExtra?: ReactNode;
  disabled?: boolean;
  onBack: () => void;
  /** Names the screen `onBack` returns to; must track the real action. */
  backLabel: string;
  onMore?: () => void;
  moreAccessibilityLabel?: string;
  onPlay: () => void;
  onShuffle: () => void;
  scrollY: SharedValue<number>;
  heroFaded: boolean;
  collapsed: boolean;
  /** Measured expanded height below the inset (from useDetailCollapse). */
  expandedHeight: number;
  onHeroBlockLayout: (e: LayoutChangeEvent) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const hero = getDetailHeroLayout(W, H, insets.top);
  const dist = expandedHeight - BAR_H;
  const settle = dist - 36;

  const maxH = insets.top + expandedHeight;
  const minH = insets.top + BAR_H;
  const barCenterY = insets.top + BAR_H / 2;
  const artExpandedTop = insets.top + hero.artTop;
  const thumbCenterX = spacing.md + 24 + spacing.sm + ART_COLLAPSED / 2;
  // Measured from where the artwork actually sits: landscape puts it against
  // the leading edge rather than centred, so `W / 2` would fly it off target.
  const txTarget = thumbCenterX - hero.artCenterX;
  const tyTarget = barCenterY - (artExpandedTop + hero.artSize / 2);
  const scaleTarget = ART_COLLAPSED / hero.artSize;

  // Moving a fixed-size clipping layer produces the same visible bottom edge as
  // shrinking `height`, while keeping every per-frame update to transform and
  // opacity. Its contents counter-translate so the header stays anchored as the
  // clip edge rises with the list.
  const collapseClipStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: -interpolate(
          scrollY.value,
          [0, dist],
          [0, dist],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));
  // Reanimated animated-style objects are view-specific; keep separate inverse
  // styles for the wash and foreground even though they share the same math.
  const washFixedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(
          scrollY.value,
          [0, dist],
          [0, dist],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));
  const headerFixedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(
          scrollY.value,
          [0, dist],
          [0, dist],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));
  const artStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(scrollY.value, [dist * 0.4, settle], [0, txTarget], Extrapolation.CLAMP) },
      { translateY: interpolate(scrollY.value, [0, settle], [0, tyTarget], Extrapolation.CLAMP) },
      { scale: interpolate(scrollY.value, [30, settle], [1, scaleTarget], Extrapolation.CLAMP) },
    ],
  }));
  // Lift + shrink as it fades, so the block recedes into the header rather than
  // being covered by the rising rows.
  const heroBlockStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 80], [1, 0], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(scrollY.value, [0, 95], [0, -30], Extrapolation.CLAMP) },
      { scale: interpolate(scrollY.value, [0, 95], [1, 0.97], Extrapolation.CLAMP) },
    ],
  }));
  // The buttons sit closest to the incoming rows — lift and fade them a touch
  // ahead of the text for a light stagger.
  const heroButtonsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 58], [1, 0], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(scrollY.value, [0, 75], [0, -16], Extrapolation.CLAMP) }],
  }));
  const barBgStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [dist - 100, dist - 20], [0, 1], Extrapolation.CLAMP),
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 45], [1, 0], Extrapolation.CLAMP),
  }));
  const barTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [settle - 30, settle + 10], [0, 1], Extrapolation.CLAMP),
  }));
  const barIconsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [settle - 24, settle + 16], [0, 1], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(scrollY.value, [settle - 24, settle + 16], [0.7, 1], Extrapolation.CLAMP) },
    ],
  }));

  return (
    <View style={[styles.container, { height: maxH }]} pointerEvents="box-none">
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.collapseClip, collapseClipStyle]}
        pointerEvents="box-none"
      >
      {/* The wash counter-translates to stay fixed while the clip's bottom edge rises. */}
      <Animated.View
        style={[styles.wash, { height: maxH }, washFixedStyle]}
        pointerEvents="none"
      >
        {backdropUri ? (
          <Image source={{ uri: backdropUri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} transition={null} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.washFallback]} />
        )}
        <View style={styles.scrim} />
      </Animated.View>
      <BottomFade />

      <Animated.View
        style={[StyleSheet.absoluteFill, headerFixedStyle]}
        pointerEvents="box-none"
      >
      <Animated.View style={[styles.barBg, { height: minH }, barBgStyle]} pointerEvents="none">
        {backdropUri ? (
          <>
            <Image source={{ uri: backdropUri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} transition={null} />
            <View style={styles.barScrim} />
          </>
        ) : (
          <View style={styles.barSolid} />
        )}
      </Animated.View>

      <Animated.View
        style={[
          styles.heroBlock,
          {
            top: insets.top + hero.blockTop,
            left: hero.blockLeft,
            right: hero.blockRight,
            alignItems: hero.blockAlign,
          },
          heroBlockStyle,
        ]}
        pointerEvents={heroFaded ? 'none' : 'auto'}
        onLayout={onHeroBlockLayout}
      >
        <Text
          variant="title"
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.72}
          style={[styles.heroTitle, { textAlign: hero.textAlign }]}
        >
          {title}
        </Text>
        {heroMeta}
        {heroExtra}
        <Animated.View style={[styles.actionRow, heroButtonsStyle]}>
          <AppPressable feedback="accent"  unstable_pressDelay={SCROLL_PRESS_DELAY}
            style={[styles.actionButton, styles.primaryAction, disabled && styles.disabledAction]}
            onPress={onPlay}
            disabled={disabled}
            accessibilityRole="button"
          >
            <Ionicons name="play" size={17} color={colors.bgPrimary} />
            <Text variant="body" style={styles.primaryActionText}>
              Play
            </Text>
          </AppPressable>
          <AppPressable feedback="control"  unstable_pressDelay={SCROLL_PRESS_DELAY}
            style={[styles.actionButton, styles.secondaryAction, disabled && styles.disabledAction]}
            onPress={onShuffle}
            disabled={disabled}
            accessibilityRole="button"
          >
            <Ionicons name="shuffle" size={17} color={colors.accent} />
            <Text variant="body" color={colors.accent} style={styles.secondaryActionText}>
              Shuffle
            </Text>
          </AppPressable>
        </Animated.View>
      </Animated.View>

      <AppPressable feedback="control"  unstable_pressDelay={SCROLL_PRESS_DELAY}
        onPress={onBack}
        hitSlop={8}
        style={[styles.chevron, { top: barCenterY - 12, left: spacing.md }]}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
      </AppPressable>
      <Animated.Text
        numberOfLines={1}
        style={[
          styles.label,
          // Bounded so a long artist name ellipsizes instead of running off the
          // edge; clears the overflow button when the screen has one.
          { top: barCenterY - 10, left: spacing.md + 26, right: onMore ? 56 : spacing.md },
          labelStyle,
        ]}
      >
        {backLabel}
      </Animated.Text>

      <Animated.Text
        numberOfLines={1}
        style={[
          styles.barTitle,
          { top: barCenterY - 12, left: thumbCenterX + ART_COLLAPSED / 2 + spacing.sm, right: onMore ? 124 : 84 },
          barTitleStyle,
        ]}
      >
        {title}
      </Animated.Text>

      <Animated.View
        style={[styles.barIcons, { top: barCenterY - 16, right: onMore ? spacing.md + 40 : spacing.md }, barIconsStyle]}
        pointerEvents={collapsed ? 'auto' : 'none'}
      >
        <AppPressable feedback="control"  unstable_pressDelay={SCROLL_PRESS_DELAY} onPress={onPlay} disabled={disabled} hitSlop={6} style={styles.iconBtn}>
          <Ionicons name="play" size={20} color={colors.accent} />
        </AppPressable>
        <AppPressable feedback="control"  unstable_pressDelay={SCROLL_PRESS_DELAY} onPress={onShuffle} disabled={disabled} hitSlop={6} style={styles.iconBtn}>
          <Ionicons name="shuffle" size={20} color={colors.accent} />
        </AppPressable>
      </Animated.View>

      {onMore ? (
        <AppPressable feedback="control"  unstable_pressDelay={SCROLL_PRESS_DELAY}
          onPress={onMore}
          hitSlop={8}
          style={[styles.moreButton, { top: barCenterY - 16, right: spacing.md }]}
          accessibilityRole="button"
          accessibilityLabel={moreAccessibilityLabel}
        >
          <Ionicons name="ellipsis-horizontal" size={22} color={colors.textPrimary} />
        </AppPressable>
      ) : null}

      {/* Rendered last so the large art sits on top of the header text until it tucks away. */}
      <Animated.View
        style={[
          styles.art,
          {
            top: artExpandedTop,
            left: hero.artLeft,
            width: hero.artSize,
            height: hero.artSize,
          },
          artStyle,
        ]}
        pointerEvents="none"
      >
        {artwork}
      </Animated.View>
      </Animated.View>
      </Animated.View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  collapseClip: {
    overflow: 'hidden',
  },
  wash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  washFallback: {
    backgroundColor: colors.bgTertiary,
    opacity: 0.55,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bgPrimary,
    opacity: 0.5,
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: FADE_H,
  },
  barBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  barScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bgSecondary,
    opacity: 0.82,
  },
  barSolid: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bgSecondary,
  },
  // left / right / alignItems come from getDetailHeroLayout: the block sits
  // under the artwork in portrait and beside it in landscape.
  heroBlock: {
    position: 'absolute',
    gap: spacing.xs,
  },
  heroTitle: {
    maxWidth: '100%',
  },
  actionRow: {
    width: '100%',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  actionButton: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
  },
  primaryAction: {
    backgroundColor: colors.accent,
  },
  secondaryAction: {
    borderColor: colors.accent,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.glassBg,
  },
  disabledAction: {
    opacity: 0.45,
  },
  primaryActionText: {
    color: colors.bgPrimary,
    fontWeight: '600',
  },
  secondaryActionText: {
    fontWeight: '600',
  },
  chevron: {
    position: 'absolute',
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    position: 'absolute',
    color: colors.textSecondary,
    fontSize: 15,
  },
  barTitle: {
    position: 'absolute',
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
  },
  barIcons: {
    position: 'absolute',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  iconBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreButton: {
    position: 'absolute',
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  art: {
    position: 'absolute',
    borderRadius: radius.lg,
    backgroundColor: colors.bgTertiary,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
