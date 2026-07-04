import {
  useRef,
  useState,
  type ReactNode
} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Extrapolation,
  interpolate,
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
  colors,
  radius,
  spacing
} from '@/theme';

// Collapsing detail header. An absolute container whose height shrinks with the
// scroll and clips its faded content, so the track list (padded to the expanded
// height) rises to meet it — no mid-scroll dead space. The artwork is a single
// element that shrinks/tucks into the top-left corner as the header collapses.
// Tune on device.
const ART_SIZE = 210;
const ART_COLLAPSED = 34;
const BAR_H = 48;
const ART_TOP = 44;
/** Top of the title/meta/buttons block, just below the artwork. */
const HERO_BLOCK_TOP = 262;
/** Gap below the buttons to the header's bottom edge (where row 1 sits at rest). */
const BLOCK_BOTTOM_PAD = 20;
/** Expanded header height below the inset until the block is measured. */
const FALLBACK_EXPANDED = 424;
const FADE_H = 150;

/**
 * Scroll plumbing. Measures the hero block so the header height (and thus the
 * collapse distance and the list's top padding) adapt to the title length —
 * long titles don't clip the buttons. `heroFaded` disables the big (now-invisible)
 * buttons before `collapsed` enables the header's icon buttons, so neither steals
 * taps mid-transition.
 */
export function useDetailCollapse() {
  const scrollY = useSharedValue(0);
  const [expandedHeight, setExpandedHeight] = useState(FALLBACK_EXPANDED);
  const expandedRef = useRef(FALLBACK_EXPANDED);
  const ref = useRef({ heroFaded: false, collapsed: false });
  const [state, setState] = useState({ heroFaded: false, collapsed: false });

  const onHeroBlockLayout = (e: LayoutChangeEvent) => {
    const next = HERO_BLOCK_TOP + e.nativeEvent.layout.height + BLOCK_BOTTOM_PAD;
    if (Math.abs(next - expandedRef.current) > 1) {
      expandedRef.current = next;
      setExpandedHeight(next);
    }
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    scrollY.value = y;
    const dist = expandedRef.current - BAR_H;
    const heroFaded = y >= 60;
    const collapsed = y >= dist - 40;
    if (heroFaded !== ref.current.heroFaded || collapsed !== ref.current.collapsed) {
      ref.current = { heroFaded, collapsed };
      setState({ heroFaded, collapsed });
    }
  };

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
  onPlay: () => void;
  onShuffle: () => void;
  scrollY: SharedValue<number>;
  heroFaded: boolean;
  collapsed: boolean;
  /** Measured expanded height below the inset (from useDetailCollapse). */
  expandedHeight: number;
  onHeroBlockLayout: (e: LayoutChangeEvent) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: W } = useWindowDimensions();
  const dist = expandedHeight - BAR_H;
  const settle = dist - 36;

  const maxH = insets.top + expandedHeight;
  const minH = insets.top + BAR_H;
  const barCenterY = insets.top + BAR_H / 2;
  const artExpandedTop = insets.top + ART_TOP;
  const thumbCenterX = spacing.md + 24 + spacing.sm + ART_COLLAPSED / 2;
  const txTarget = thumbCenterX - W / 2;
  const tyTarget = barCenterY - (artExpandedTop + ART_SIZE / 2);
  const scaleTarget = ART_COLLAPSED / ART_SIZE;

  const containerStyle = useAnimatedStyle(() => ({
    height: interpolate(scrollY.value, [0, dist], [maxH, minH], Extrapolation.CLAMP),
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
    <Animated.View style={[styles.container, containerStyle]} pointerEvents="box-none">
      {/* Blurred wash (fixed tall, clipped by the shrinking container) + fade at the bottom edge. */}
      <View style={[styles.wash, { height: maxH }]} pointerEvents="none">
        {backdropUri ? (
          <Image source={{ uri: backdropUri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} transition={null} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.washFallback]} />
        )}
        <View style={styles.scrim} />
      </View>
      <BottomFade />

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
        style={[styles.heroBlock, { top: insets.top + HERO_BLOCK_TOP }, heroBlockStyle]}
        pointerEvents={heroFaded ? 'none' : 'auto'}
        onLayout={onHeroBlockLayout}
      >
        <Text variant="title" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.72} style={styles.heroTitle}>
          {title}
        </Text>
        {heroMeta}
        {heroExtra}
        <Animated.View style={[styles.actionRow, heroButtonsStyle]}>
          <Pressable
            style={[styles.actionButton, styles.primaryAction, disabled && styles.disabledAction]}
            onPress={onPlay}
            disabled={disabled}
            accessibilityRole="button"
          >
            <Ionicons name="play" size={17} color={colors.bgPrimary} />
            <Text variant="body" style={styles.primaryActionText}>
              Play
            </Text>
          </Pressable>
          <Pressable
            style={[styles.actionButton, styles.secondaryAction, disabled && styles.disabledAction]}
            onPress={onShuffle}
            disabled={disabled}
            accessibilityRole="button"
          >
            <Ionicons name="shuffle" size={17} color={colors.accent} />
            <Text variant="body" color={colors.accent} style={styles.secondaryActionText}>
              Shuffle
            </Text>
          </Pressable>
        </Animated.View>
      </Animated.View>

      <Pressable
        onPress={onBack}
        hitSlop={8}
        style={[styles.chevron, { top: barCenterY - 12, left: spacing.md }]}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
      </Pressable>
      <Animated.Text style={[styles.label, { top: barCenterY - 10, left: spacing.md + 26 }, labelStyle]}>
        Library
      </Animated.Text>

      <Animated.Text
        numberOfLines={1}
        style={[
          styles.barTitle,
          { top: barCenterY - 12, left: thumbCenterX + ART_COLLAPSED / 2 + spacing.sm, right: 84 },
          barTitleStyle,
        ]}
      >
        {title}
      </Animated.Text>

      <Animated.View
        style={[styles.barIcons, { top: barCenterY - 16, right: spacing.md }, barIconsStyle]}
        pointerEvents={collapsed ? 'auto' : 'none'}
      >
        <Pressable onPress={onPlay} disabled={disabled} hitSlop={6} style={styles.iconBtn}>
          <Ionicons name="play" size={20} color={colors.accent} />
        </Pressable>
        <Pressable onPress={onShuffle} disabled={disabled} hitSlop={6} style={styles.iconBtn}>
          <Ionicons name="shuffle" size={20} color={colors.accent} />
        </Pressable>
      </Animated.View>

      {/* Rendered last so the large art sits on top of the header text until it tucks away. */}
      <Animated.View
        style={[
          styles.art,
          { top: artExpandedTop, left: (W - ART_SIZE) / 2, width: ART_SIZE, height: ART_SIZE },
          artStyle,
        ]}
        pointerEvents="none"
      >
        {artwork}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
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
  heroBlock: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  heroTitle: {
    maxWidth: '100%',
    textAlign: 'center',
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
});
