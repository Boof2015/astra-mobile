import { createContext, useContext, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInLeft,
  FadeInRight,
  KeyboardState,
  ReduceMotion,
  useAnimatedKeyboard,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { AppPressable } from '@/components/AppPressable';
import { EDGE_TO_EDGE_KEYBOARD } from '@/components/KeyboardAvoidingArea';
import { Text } from '@/components/Text';
import { showAppDialog } from '@/components/dialogs/AppDialog';
import { TAB_SCENE_TRANSLATION_DP } from '@/navigation/tabTransition';
import { useLibraryStore } from '@/stores/libraryStore';
import { useThemeStore } from '@/stores/themeStore';
import { fonts, spacing } from '@/theme';
import { mixHex } from '@/theme/colorUtils';
import { motion } from '@/theme/motion';
import { createThemedStyles, useColors } from '@/theme/themed';
import type { ScanNotificationPermission } from '@/library/useScanNotificationPermission';
import { MarkBackdrop } from './OnboardingBrand';
import {
  ONBOARDING_CHROME_HEIGHT,
  ONBOARDING_FOOTER_BOTTOM,
  ONBOARDING_FOOTER_TOP,
  ONBOARDING_GUTTER,
  ONBOARDING_SUBTITLE_LINES,
  ONBOARDING_TITLE_LINES,
  ONBOARDING_TITLE_TOP,
  type OnboardingLayout,
} from './onboardingLayout';
import type { OnboardingPage } from './onboardingSteps';

export interface OnboardingNav {
  page: OnboardingPage;
  direction: 1 | -1;
  layout: OnboardingLayout;
  /** Fill per progress segment (0..1). */
  progress: number[];
  /** "2 of 4"; null on bookends. */
  position: { index: number; count: number } | null;
  next: () => void;
  back: () => void;
  goTo: (page: OnboardingPage) => void;
  finish: () => void;
  /** A server connect is in flight: back is swallowed until it settles. */
  setBusy: (busy: boolean) => void;
  notificationPermission: ScanNotificationPermission;
}

export const OnboardingNavContext = createContext<OnboardingNav | null>(null);

export function useOnboardingNav(): OnboardingNav {
  const nav = useContext(OnboardingNavContext);
  if (!nav) throw new Error('useOnboardingNav must be used inside OnboardingFlow');
  return nav;
}

// Module-level so the builders are created once. Title + content travel 20dp
// (the tab scenes' distance) and fade; chrome and footer never animate.
const ENTER_FORWARD = FadeInRight.duration(motion.snap.duration)
  .easing(Easing.out(Easing.cubic))
  .withInitialValues({ opacity: 0, transform: [{ translateX: TAB_SCENE_TRANSLATION_DP }] })
  .reduceMotion(ReduceMotion.System);
const ENTER_BACK = FadeInLeft.duration(motion.snap.duration)
  .easing(Easing.out(Easing.cubic))
  .withInitialValues({ opacity: 0, transform: [{ translateX: -TAB_SCENE_TRANSLATION_DP }] })
  .reduceMotion(ReduceMotion.System);
const ENTER_BOOKEND = FadeIn.duration(320).easing(Easing.out(Easing.cubic)).reduceMotion(ReduceMotion.System);

interface FrameProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  footer: ReactNode;
  children: ReactNode;
  /**
   * The page has text fields. The app is edge-to-edge, so Android no longer
   * resizes the window for the keyboard (adjustResize is ignored): this page
   * has to make room itself.
   */
  keyboardAware?: boolean;
}

/**
 * One wizard page: chrome, the fixed title block, the elastic content region
 * and the rigid footer. Every number that places a control is declared in
 * onboardingLayout.ts; only the content region flexes.
 */
export function OnboardingFrame(props: FrameProps) {
  return props.keyboardAware ? <KeyboardAwareFrame {...props} /> : <FrameBody {...props} />;
}

/**
 * Keyboard handling for pages with fields, tracked on the UI thread so it moves
 * with the keyboard's own animation:
 * - a spacer under the footer grows with the keyboard, so the footer rides on
 *   top of it and the content region shrinks (Android's ScrollView then keeps
 *   the focused field on screen);
 * - on a phone the title block folds away while the keyboard is open, because
 *   with it the form would get ~120dp. Chrome (back + progress) stays.
 */
function KeyboardAwareFrame(props: FrameProps) {
  const nav = useOnboardingNav();
  const insets = useSafeAreaInsets();
  // Full IME inset, nav bar included (see EDGE_TO_EDGE_KEYBOARD), so the bottom
  // inset the wizard already pays comes off it.
  const keyboard = useAnimatedKeyboard(EDGE_TO_EDGE_KEYBOARD);
  const bottomInset = insets.bottom;
  const titleHeight = nav.layout.titleBlockHeight;
  const collapse = useSharedValue(0);

  useAnimatedReaction(
    () => keyboard.state.get(),
    (state) => {
      if (state === KeyboardState.OPENING || state === KeyboardState.OPEN) collapse.set(withTiming(1, motion.snap));
      else if (state === KeyboardState.CLOSING || state === KeyboardState.CLOSED) collapse.set(withTiming(0, motion.snap));
    }
  );

  const titleStyle = useAnimatedStyle(() => ({
    height: titleHeight * (1 - collapse.get()),
    opacity: 1 - collapse.get(),
  }));
  const spacerStyle = useAnimatedStyle(() => ({
    height: Math.max(0, keyboard.height.get() - bottomInset),
  }));

  return (
    <FrameBody
      {...props}
      wrapTitle={
        nav.layout.presentation === 'stack'
          ? (block) => <Animated.View style={[{ overflow: 'hidden' }, titleStyle]}>{block}</Animated.View>
          : undefined
      }
      keyboardSpacer={<Animated.View style={spacerStyle} />}
    />
  );
}

function FrameBody({
  eyebrow,
  title,
  subtitle,
  footer,
  children,
  wrapTitle,
  keyboardSpacer,
}: FrameProps & { wrapTitle?: (block: ReactNode) => ReactNode; keyboardSpacer?: ReactNode }) {
  const styles = useStyles();
  const colors = useColors();
  const nav = useOnboardingNav();
  const { layout } = nav;
  const entering = nav.direction > 0 ? ENTER_FORWARD : ENTER_BACK;
  const eyebrowText = nav.position ? `${nav.position.index} of ${nav.position.count} · ${eyebrow}` : eyebrow;

  const titleInner = (
    <Animated.View entering={entering} style={[styles.titleBlock, { height: layout.titleBlockHeight }]}>
      <Text
        variant="mono"
        allowFontScaling={false}
        numberOfLines={1}
        color={colors.accentText}
        style={[styles.eyebrow, layout.type.eyebrow]}
      >
        {eyebrowText.toUpperCase()}
      </Text>
      <Text
        variant="title"
        allowFontScaling={false}
        numberOfLines={ONBOARDING_TITLE_LINES}
        accessibilityRole="header"
        style={[styles.title, layout.type.title]}
      >
        {title}
      </Text>
      <Text
        variant="body"
        allowFontScaling={false}
        numberOfLines={ONBOARDING_SUBTITLE_LINES}
        color={colors.textSecondary}
        style={[styles.subtitle, layout.type.subtitle]}
      >
        {subtitle}
      </Text>
    </Animated.View>
  );
  const titleBlock = wrapTitle ? wrapTitle(titleInner) : titleInner;

  const content = (
    <Animated.View entering={entering} style={styles.flex}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.contentInner}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </Animated.View>
  );

  const footerView = <View style={[styles.footer, { height: layout.footerHeight }]}>{footer}</View>;

  if (layout.presentation === 'split') {
    return (
      <View style={styles.splitRow}>
        <View style={{ width: layout.titleColumnWidth }}>
          <OnboardingChrome />
          {titleBlock}
        </View>
        <View style={styles.flex}>
          <View style={styles.splitContentTop} />
          {content}
          {footerView}
          {keyboardSpacer}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <OnboardingChrome />
      {titleBlock}
      {content}
      {footerView}
      {keyboardSpacer}
    </View>
  );
}

/** Back + segmented progress, plus the scan chip once you've left the music page. */
function OnboardingChrome() {
  const styles = useStyles();
  const colors = useColors();
  const nav = useOnboardingNav();
  return (
    <View style={styles.chrome}>
      <AppPressable
        feedback="control"
        onPress={nav.back}
        style={styles.back}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={24} color={colors.textSecondary} />
      </AppPressable>
      <View
        style={styles.progress}
        accessibilityRole="progressbar"
        accessibilityLabel={nav.position ? `Step ${nav.position.index} of ${nav.position.count}` : undefined}
      >
        {nav.progress.map((fill, index) => (
          <View key={index} style={styles.segment}>
            <View style={[styles.segmentFill, { width: `${fill * 100}%` }]} />
          </View>
        ))}
      </View>
      {nav.page !== 'music' ? <ScanChip /> : null}
    </View>
  );
}

/**
 * The one place a running scan shows on later pages. It is a real button: the
 * dialog it opens holds Cancel, which has to stay reachable for as long as the
 * scan's foreground service runs.
 */
function ScanChip() {
  const styles = useStyles();
  const colors = useColors();
  const isScanning = useLibraryStore((s) => s.isScanning);
  const isCancelling = useLibraryStore((s) => s.isCancelling);
  const progress = useLibraryStore((s) => s.scanProgress);
  if (!isScanning) return null;
  const counted = (progress.phase === 'extracting' || progress.phase === 'analyzing') && progress.total > 0;
  const fraction = counted ? Math.min(1, progress.processed / progress.total) : 0;
  const percent = Math.round(fraction * 100);
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const openDialog = () => {
    showAppDialog({
      title: 'Scanning your library',
      message: counted
        ? `${progress.processed.toLocaleString('en-US')} of ${progress.total.toLocaleString('en-US')} tracks so far. The scan keeps going while you finish setup.`
        : 'Astra is still looking for music. The scan keeps going while you finish setup.',
      actions: [
        { label: 'Keep scanning', role: 'cancel' },
        { label: 'Cancel scan', role: 'destructive', onPress: () => useLibraryStore.getState().cancelScan() },
      ],
    });
  };
  return (
    <AppPressable
      feedback="control"
      onPress={openDialog}
      disabled={isCancelling}
      style={styles.scanChip}
      accessibilityRole="button"
      accessibilityLabel={isCancelling ? 'Canceling library scan' : `Library scan ${percent} percent. Show scan options`}
    >
      <Svg width={18} height={18} viewBox="0 0 18 18" style={styles.ring}>
        <Circle cx={9} cy={9} r={radius} stroke={colors.glassBorder} strokeWidth={2.5} fill="none" />
        <Circle
          cx={9}
          cy={9}
          r={radius}
          stroke={colors.accent}
          strokeWidth={2.5}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - fraction)}
        />
      </Svg>
      <Text variant="mono" color={colors.textSecondary} style={styles.chipText}>
        {isCancelling ? '…' : counted ? `${percent}%` : 'Scan'}
      </Text>
    </AppPressable>
  );
}

/**
 * Welcome and Done: the hero at a declared height and the same rigid footer as
 * every page. The flat accent surface and the cropped mark behind it are
 * `BookendBackground`, drawn by the flow root.
 * In split, `aside` (Done's covers) takes the right column.
 */
export function OnboardingBookend({
  hero,
  aside,
  heroTop,
  align = 'start',
  footer,
}: {
  hero: ReactNode;
  aside?: ReactNode;
  heroTop: number;
  align?: 'start' | 'center';
  footer: ReactNode;
}) {
  const styles = useStyles();
  const nav = useOnboardingNav();
  const { layout } = nav;
  const heroStyle = [styles.hero, { top: heroTop }, align === 'center' ? styles.heroCenter : null];
  const footerView = <View style={[styles.footer, { height: layout.footerHeight }]}>{footer}</View>;

  if (layout.presentation === 'split') {
    return (
      <View style={styles.bookend}>
        <View style={styles.splitRow}>
          <View style={{ width: layout.titleColumnWidth }}>
            <Animated.View entering={ENTER_BOOKEND} style={heroStyle}>
              {hero}
            </Animated.View>
          </View>
          <View style={styles.flex}>
            <View style={styles.flex}>
              {aside ? (
                <Animated.View entering={ENTER_BOOKEND} style={[styles.hero, styles.heroCenter, { top: heroTop }]}>
                  {aside}
                </Animated.View>
              ) : null}
            </View>
            {footerView}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.bookend}>
      <View style={styles.flex}>
        <Animated.View entering={ENTER_BOOKEND} style={heroStyle}>
          {aside}
          {hero}
        </Animated.View>
      </View>
      {footerView}
    </View>
  );
}

/**
 * Full-bleed background for the bookends, drawn by the flow root under the
 * safe-area padding so the color and the mark run behind the system bars.
 */
export function BookendBackground({ size }: { size: number }) {
  const surfaces = useBookendColors();
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: surfaces.surface, overflow: 'hidden' }]}>
      <MarkBackdrop size={size} near={surfaces.near} far={surfaces.far} />
    </View>
  );
}

/** Flat tints of the accent over the base surface, chosen in the onboarding lab ("Subtle"). */
export function useBookendColors(): { surface: string; near: string; far: string } {
  const colors = useColors();
  const isDark = useThemeStore((s) => s.theme.isDark);
  return {
    surface: mixHex(colors.bgPrimary, colors.accent, isDark ? 0.07 : 0.05),
    near: mixHex(colors.bgPrimary, colors.accent, isDark ? 0.17 : 0.12),
    far: mixHex(colors.bgPrimary, colors.accent, isDark ? 0.27 : 0.2),
  };
}

const useStyles = createThemedStyles((colors) => ({
  flex: {
    flex: 1,
  },
  splitRow: {
    flex: 1,
    flexDirection: 'row',
  },
  splitContentTop: {
    height: ONBOARDING_CHROME_HEIGHT + ONBOARDING_TITLE_TOP,
  },
  chrome: {
    height: ONBOARDING_CHROME_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 6,
    paddingRight: ONBOARDING_GUTTER,
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progress: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.glassBorder,
    overflow: 'hidden',
  },
  segmentFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  scanChip: {
    height: 32,
    marginLeft: spacing.sm,
    paddingLeft: 7,
    paddingRight: 11,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ring: {
    transform: [{ rotate: '-90deg' }],
  },
  chipText: {
    fontSize: 11,
    lineHeight: 14,
  },
  titleBlock: {
    paddingTop: ONBOARDING_TITLE_TOP,
    paddingHorizontal: ONBOARDING_GUTTER,
    overflow: 'hidden',
  },
  eyebrow: {
    fontFamily: fonts.mono.regular,
    letterSpacing: 0.9,
  },
  title: {
    marginTop: 8,
    letterSpacing: -0.5,
  },
  subtitle: {
    marginTop: 8,
  },
  contentInner: {
    paddingHorizontal: ONBOARDING_GUTTER,
    paddingBottom: spacing.lg,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingTop: ONBOARDING_FOOTER_TOP,
    paddingBottom: ONBOARDING_FOOTER_BOTTOM,
    paddingHorizontal: ONBOARDING_GUTTER,
  },
  bookend: {
    flex: 1,
    overflow: 'hidden',
  },
  hero: {
    position: 'absolute',
    left: 28,
    right: 28,
  },
  heroCenter: {
    alignItems: 'center',
  },
}));
