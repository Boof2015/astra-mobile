import { actionButtonStyle, actionButtonTextStyle } from '@/theme/actionButtons';
import { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOutUp,
  LinearTransition,
  ReduceMotion,
} from 'react-native-reanimated';
import { Canvas, LinearGradient, Rect, vec } from '@shopify/react-native-skia';
import { Ionicons } from '@expo/vector-icons';
import { AstraLogo } from '@/components/AstraLogo';
import { Text } from '@/components/Text';
import { ScanProgress } from '@/components/library/ScanProgress';
import { AccentSwatchRow } from '@/components/settings/AccentSwatchRow';
import { ScopeStyleCards } from '@/components/settings/ScopeStyleCards';
import { StepHeader } from '@/components/onboarding/StepHeader';
import { NotificationStep } from '@/components/onboarding/NotificationStep';
import { ArtistImageStep } from '@/components/onboarding/ArtistImageStep';
import { formatFolderCount, formatTrackCount } from '@/components/settings/SettingsPanels';
import { radius, spacing } from '@/theme';
import { motion } from '@/theme/motion';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable } from '@/components/AppPressable';
import { playHaptic } from '@/lib/haptics';
import type { BaseThemeId } from '@/theme/resolve';
import { useScanNotificationPermission } from '@/library/useScanNotificationPermission';
import { useLibraryStore } from '@/stores/libraryStore';
import { useSettingsStore, type NowPlayingScopeStyle } from '@/stores/settingsStore';
import { useThemeStore } from '@/stores/themeStore';

type StepId =
  | 'welcome'
  | 'library'
  | 'notifications'
  | 'artistImages'
  | 'theme'
  | 'player'
  | 'done';

// Folders first so the notification ask lands with a visible reason ("your scan
// is running"), then the Deezer consent. Each is its own page: they are three
// unrelated decisions and stacking them made the library step's real action —
// picking a folder — the third thing on screen.
const STEP_ORDER: StepId[] = [
  'welcome',
  'library',
  'notifications',
  'artistImages',
  'theme',
  'player',
  'done',
];

const WIZARD_THEME_OPTIONS: { id: BaseThemeId; title: string }[] = [
  { id: 'system', title: 'System' },
  { id: 'midnight', title: 'Midnight' },
  { id: 'dark', title: 'Dark' },
  { id: 'amoled', title: 'AMOLED' },
  { id: 'light', title: 'Light' },
  { id: 'materialYou', title: 'Material You' },
];

const DOT_TRANSITION = LinearTransition.duration(motion.snap.duration).reduceMotion(
  ReduceMotion.System
);

/**
 * First-run wizard. Rendered by the root layout instead of the app tree while
 * `onboarding_complete` is unset. Purely presentational — it drives the existing
 * library + theme stores and calls `onDone` (→ markComplete) at the end.
 */
export function OnboardingFlow({ onDone }: { onDone: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEP_ORDER[stepIndex];
  const foldersCount = useLibraryStore((s) => s.folders.length);
  const isScanning = useLibraryStore((s) => s.isScanning);
  // Owned here so the footer label can distinguish "Continue" from "Skip for
  // now" using the same state the notification step renders.
  const notificationPermission = useScanNotificationPermission();
  // Deliberately unset until tapped: preselecting a card would bias the
  // pre-release style feedback. Skipping through keeps the store default.
  const [scopeStyleChoice, setScopeStyleChoice] = useState<NowPlayingScopeStyle | null>(null);
  const chooseScopeStyle = (style: NowPlayingScopeStyle) => {
    setScopeStyleChoice(style);
    void useSettingsStore.getState().setNowPlayingScopeStyle(style);
  };

  const goNext = () => {
    if (stepIndex < STEP_ORDER.length - 1) setStepIndex((i) => i + 1);
    else onDone();
  };
  const goBack = () => setStepIndex((i) => Math.max(0, i - 1));

  const canGoBack = stepIndex > 0 && step !== 'done';
  const primaryLabel =
    step === 'welcome'
      ? 'Get started'
      : step === 'library'
        ? // A scan is orchestrated by the store (not this component), so it keeps
          // running after "Continue" — never call the forward action "Skip" while
          // it is actively working.
          foldersCount > 0 || isScanning
          ? 'Continue'
          : 'Skip for now'
        : step === 'notifications'
          ? // The grant is optional, so moving on without it really is skipping.
            notificationPermission.granted
            ? 'Continue'
            : 'Skip for now'
          : step === 'artistImages' || step === 'theme' || step === 'player'
            ? 'Continue'
            : 'Start listening';

  return (
    <View style={styles.root}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Rect x={0} y={0} width={width} height={height}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(width * 0.5, height)}
            colors={[colors.accentGlow, colors.bgPrimary, colors.bgPrimary]}
            positions={[0, 0.55, 1]}
          />
        </Rect>
      </Canvas>

      <View
        style={[
          styles.content,
          { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg },
        ]}
      >
        {/* Once past the library step, a subtle banner keeps reminding the user the
            scan they started is still running in the background (it was not stopped
            by continuing). */}
        {step !== 'library' ? <ScanBanner /> : null}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View key={step} entering={FadeIn.duration(220)} style={styles.stepWrap}>
            {step === 'welcome' ? <WelcomeStep /> : null}
            {step === 'library' ? <LibraryStep /> : null}
            {step === 'notifications' ? (
              <NotificationStep permission={notificationPermission} />
            ) : null}
            {step === 'artistImages' ? <ArtistImageStep /> : null}
            {step === 'theme' ? <ThemeStep /> : null}
            {step === 'player' ? (
              <PlayerStep choice={scopeStyleChoice} onChoose={chooseScopeStyle} />
            ) : null}
            {step === 'done' ? <DoneStep /> : null}
          </Animated.View>
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.dots}>
            {STEP_ORDER.map((id, i) => (
              <Dot key={id} active={i === stepIndex} />
            ))}
          </View>
          <View style={styles.navRow}>
            {canGoBack ? (
              <AppPressable feedback="control"
                onPress={goBack}
                style={styles.secondaryButton}
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                <Text style={actionButtonTextStyle(colors, 'secondary')} variant="label">
                  Back
                </Text>
              </AppPressable>
            ) : null}
            <AppPressable feedback="accent"
              onPress={goNext}
              style={styles.primaryButton}
              accessibilityRole="button"
              accessibilityLabel={primaryLabel}
            >
              <Text variant="label" style={actionButtonTextStyle(colors, 'primary')}>
                {primaryLabel}
              </Text>
            </AppPressable>
          </View>
        </View>
      </View>
    </View>
  );
}

function WelcomeStep() {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.centered}>
      <Animated.View entering={FadeInDown.duration(500)}>
        <AstraLogo size={96} />
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(120).duration(500)} style={styles.centeredText}>
        <Text variant="title" style={styles.centeredTitle}>
          Welcome to Astra
        </Text>
        <Text variant="body" color={colors.textSecondary} style={styles.centeredSubtitle}>
          Your music, beautifully played. Set up your library in a few taps.
        </Text>
      </Animated.View>
    </View>
  );
}

function LibraryStep() {
  const styles = useStyles();
  const colors = useColors();
  const folders = useLibraryStore((s) => s.folders);
  const totalTrackCount = useLibraryStore((s) => s.totalTrackCount);
  const isScanning = useLibraryStore((s) => s.isScanning);
  const addFolder = useLibraryStore((s) => s.addFolder);

  return (
    <View style={styles.stepBody}>
      <StepHeader
        icon="musical-notes-outline"
        title="Add your music"
        subtitle="Point Astra at the folders where your music lives. It scans them into your library — files on disk are never modified."
      />

      <AppPressable
        style={[styles.choiceButton, isScanning && styles.disabled]}
        disabled={isScanning}
        onPress={() => void addFolder()}
        accessibilityRole="button"
      >
        <Ionicons name="folder-open-outline" size={20} color={colors.textSecondary} />
        <Text style={actionButtonTextStyle(colors, 'secondary')} variant="body">
          {folders.length > 0 ? 'Add another folder' : 'Choose music folder'}
        </Text>
      </AppPressable>

      <ScanProgress />

      {isScanning ? (
        <Text variant="caption" color={colors.textTertiary} style={styles.hint}>
          Scanning keeps running in the background — continue whenever you like, or add
          more folders.
        </Text>
      ) : folders.length > 0 ? (
        <View style={styles.summaryCard}>
          <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
          <Text variant="body" color={colors.textPrimary}>
            {formatFolderCount(folders.length)} · {formatTrackCount(totalTrackCount)}
          </Text>
        </View>
      ) : (
        <Text variant="caption" color={colors.textTertiary} style={styles.hint}>
          You can skip this and add folders later from Settings › Library.
        </Text>
      )}
    </View>
  );
}

function ThemeStep() {
  const styles = useStyles();
  const colors = useColors();
  const baseTheme = useThemeStore((s) => s.baseTheme);
  const materialYouAvailable = useThemeStore((s) => s.materialYouAvailable);
  const resolvedId = useThemeStore((s) => s.theme.id);
  const setBaseTheme = useThemeStore((s) => s.setBaseTheme);

  const options = WIZARD_THEME_OPTIONS.filter(
    (option) => option.id !== 'materialYou' || materialYouAvailable
  );
  const accentApplies = !resolvedId.startsWith('materialYou');

  return (
    <View style={styles.stepBody}>
      <StepHeader
        icon="color-palette-outline"
        title="Make it yours"
        subtitle="Pick a theme. You can change it anytime in Settings."
      />
      <View style={styles.themeGrid}>
        {options.map((option) => {
          const selected = option.id === baseTheme;
          return (
            <AppPressable
              key={option.id}
              onPress={() => {
                if (selected) return;
                playHaptic('selection');
                void setBaseTheme(option.id);
              }}
              style={[styles.themePill, selected && styles.themePillSelected]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <Text
                variant="label"
                color={selected ? colors.accentTextStrong : colors.textSecondary}
              >
                {option.title}
              </Text>
            </AppPressable>
          );
        })}
      </View>
      {accentApplies ? (
        <View style={styles.accentBlock}>
          <AccentSwatchRow />
        </View>
      ) : null}
    </View>
  );
}

function PlayerStep({
  choice,
  onChoose,
}: {
  choice: NowPlayingScopeStyle | null;
  onChoose: (style: NowPlayingScopeStyle) => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.stepBody}>
      <StepHeader
        icon="pulse-outline"
        title="Pick your player look"
        subtitle="The player can show live scopes of the music. Choose where they live — you can change this anytime in Settings."
      />
      <ScopeStyleCards value={choice} onChange={onChoose} />
    </View>
  );
}

function DoneStep() {
  const styles = useStyles();
  const colors = useColors();
  const totalTrackCount = useLibraryStore((s) => s.totalTrackCount);
  return (
    <View style={styles.centered}>
      <Animated.View entering={FadeInDown.duration(400)} style={styles.doneBadge}>
        <Ionicons name="checkmark" size={44} color={colors.bgPrimary} />
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(100).duration(400)} style={styles.centeredText}>
        <Text variant="title" style={styles.centeredTitle}>
          All set
        </Text>
        <Text variant="body" color={colors.textSecondary} style={styles.centeredSubtitle}>
          {totalTrackCount > 0
            ? `${formatTrackCount(totalTrackCount)} ready to play.`
            : 'Add music anytime from Settings › Library.'}
        </Text>
      </Animated.View>
    </View>
  );
}

/** Subtle "still scanning" pill shown at the top of steps after the library step. */
function ScanBanner() {
  const styles = useStyles();
  const colors = useColors();
  const isScanning = useLibraryStore((s) => s.isScanning);
  const isCancelling = useLibraryStore((s) => s.isCancelling);
  const progress = useLibraryStore((s) => s.scanProgress);
  const cancelScan = useLibraryStore((s) => s.cancelScan);
  if (!isScanning) return null;
  const detail =
    (progress.phase === 'extracting' || progress.phase === 'analyzing') && progress.total > 0
      ? `${progress.processed}/${progress.total}`
      : null;
  return (
    <Animated.View
      entering={FadeInDown.duration(220)}
      exiting={FadeOutUp.duration(160)}
      style={styles.scanBanner}
    >
      <ActivityIndicator size="small" color={colors.accent} />
      <Text
        variant="caption"
        color={colors.textSecondary}
        numberOfLines={1}
        style={styles.scanBannerText}
      >
        {isCancelling
          ? 'Cancelling library scan…'
          : `Scanning your library${detail ? ` · ${detail}` : '…'}`}
      </Text>
      <AppPressable feedback="control"

        disabled={isCancelling}
        onPress={cancelScan}
        accessibilityRole="button"
        accessibilityLabel={isCancelling ? 'Cancelling library scan' : 'Cancel library scan'}
        accessibilityState={{ disabled: isCancelling, busy: isCancelling }}
        hitSlop={6}
        style={styles.scanBannerCancel}
      >
        <Text
          variant="caption"
          color={isCancelling ? colors.textTertiary : colors.warning}
        >
          {isCancelling ? 'Cancelling…' : 'Cancel'}
        </Text>
      </AppPressable>
    </Animated.View>
  );
}

/** Page indicator dot — widens + brightens when active. Animated View, not an icon. */
function Dot({ active }: { active: boolean }) {
  const styles = useStyles();
  return (
    <Animated.View
      layout={DOT_TRANSITION}
      style={[styles.dot, active ? styles.dotActive : styles.dotInactive]}
    />
  );
}

const useStyles = createThemedStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  scanBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  scanBannerText: {
    flexShrink: 1,
  },
  scanBannerCancel: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  stepWrap: {
    width: '100%',
  },
  centered: {
    alignItems: 'center',
    gap: spacing.xl,
  },
  centeredText: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  centeredTitle: {
    textAlign: 'center',
  },
  centeredSubtitle: {
    textAlign: 'center',
    maxWidth: 340,
  },
  doneBadge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBody: {
    width: '100%',
    gap: spacing.lg,
  },
  choiceButton: {
    ...actionButtonStyle(colors, 'secondary'),
    minHeight: 52,
  },
  disabled: {
    opacity: 0.5,
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  hint: {
    textAlign: 'center',
  },
  themeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  themePill: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  themePillSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentGlow,
  },
  accentBlock: {
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  footer: {
    gap: spacing.lg,
    paddingTop: spacing.md,
  },
  dots: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dot: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  dotActive: {
    width: 22,
    opacity: 1,
  },
  dotInactive: {
    width: 8,
    opacity: 0.3,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  secondaryButton: {
    ...actionButtonStyle(colors, 'secondary'),
    minHeight: 52,
  },
  primaryButton: {
    ...actionButtonStyle(colors, 'primary'),
    flex: 1,
    minHeight: 52,
  },
}));

export default OnboardingFlow;
