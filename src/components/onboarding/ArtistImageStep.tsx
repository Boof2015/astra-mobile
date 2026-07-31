import { useEffect, type ComponentProps, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { StepHeader } from '@/components/onboarding/StepHeader';
import { radius, spacing } from '@/theme';
import { motion } from '@/theme/motion';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import { playHaptic } from '@/lib/haptics';
import { useSettingsStore } from '@/stores/settingsStore';
import type { ArtistImageAutoPolicy } from '@/types/artistImages';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

const POLICY_OPTIONS: {
  policy: ArtistImageAutoPolicy;
  icon: IoniconName;
  title: string;
  description: string;
}[] = [
  {
    policy: 'wifi',
    icon: 'wifi-outline',
    title: 'Wi-Fi or Ethernet',
    description: 'Recommended — never uses mobile data.',
  },
  {
    policy: 'any',
    icon: 'cellular-outline',
    title: 'Any network',
    description: 'Includes mobile data.',
  },
  {
    policy: 'off',
    icon: 'remove-circle-outline',
    title: 'Off',
    description: 'Nothing is sent. Manual search still works.',
  },
];

/**
 * Wizard page for the Deezer artist-image disclosure. Unlike the settings row
 * this flattens the toggle-plus-segmented-control into three equal-weight cards:
 * the network choice is the same decision as opting in, so hiding it behind a
 * switch made a consent screen read as two unrelated controls.
 *
 * The current policy is preselected (unlike the scope-style step, which stays
 * unset to avoid biasing taste feedback) — on a consent page the user needs to
 * see what will actually happen if they just tap Continue.
 */
export function ArtistImageStep() {
  const styles = useStyles();
  const colors = useColors();
  const policy = useSettingsStore((s) => s.artistImageAutoPolicy);
  const setPolicy = useSettingsStore((s) => s.setArtistImageAutoPolicy);

  const choose = (next: ArtistImageAutoPolicy) => {
    if (next === policy) return;
    playHaptic('selection');
    void setPolicy(next);
  };

  return (
    <View style={styles.stepBody}>
      <StepHeader
        icon="person-circle-outline"
        title="Artist portraits"
        subtitle="Astra can look up artist photos on Deezer and store them on your device, so they show up offline too."
      />

      <PortraitPreview enabled={policy !== 'off'} />

      <View style={styles.options}>
        {POLICY_OPTIONS.map((option) => (
          <PolicyCard
            key={option.policy}
            icon={option.icon}
            title={option.title}
            description={option.description}
            selected={option.policy === policy}
            onPress={() => choose(option.policy)}
          />
        ))}
      </View>

      <Text variant="caption" color={colors.textTertiary} style={styles.footnote}>
        Only the artist name is sent. Change this anytime in Settings › Library.
      </Text>
    </View>
  );
}

/**
 * Side-by-side sketch of an artist tile with a portrait vs. the album-art
 * fallback. The highlight follows the choice below — picking "Off" moves it to
 * the fallback tile, so the cards and the preview always agree.
 */
function PortraitPreview({ enabled }: { enabled: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.preview}>
      <PreviewTile active={enabled} label="With portraits">
        <Ionicons
          name="person"
          size={22}
          color={enabled ? colors.accent : colors.textTertiary}
        />
      </PreviewTile>
      <PreviewTile active={!enabled} label="Album art only">
        <View style={styles.previewAlbumSquare} />
      </PreviewTile>
    </View>
  );
}

/**
 * Two stacked circle layers cross-faded by opacity rather than an animated
 * border/background colour — the repo's established way to move a highlight
 * without handing colours to a worklet.
 */
function PreviewTile({
  active,
  label,
  children,
}: {
  active: boolean;
  label: string;
  children: ReactNode;
}) {
  const styles = useStyles();
  const colors = useColors();
  const progress = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, motion.snap);
  }, [active, progress]);
  const tileStyle = useAnimatedStyle(() => ({ opacity: 0.42 + progress.value * 0.58 }));
  const accentStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  return (
    <Animated.View style={[styles.previewItem, tileStyle]}>
      <View style={styles.previewCircleWrap}>
        <View style={[styles.previewCircleLayer, styles.previewCircleNeutral]} />
        <Animated.View
          style={[styles.previewCircleLayer, styles.previewCircleAccent, accentStyle]}
        />
        {children}
      </View>
      <View style={styles.previewNameLine} />
      <Text variant="caption" color={active ? colors.textSecondary : colors.textTertiary}>
        {label}
      </Text>
    </Animated.View>
  );
}

function PolicyCard({
  icon,
  title,
  description,
  selected,
  onPress,
}: {
  icon: IoniconName;
  title: string;
  description: string;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  return (
    <Pressable
      android_ripple={ripple.bounded}
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${description}`}
    >
      <View style={[styles.cardIcon, selected && styles.cardIconSelected]}>
        <Ionicons
          name={icon}
          size={20}
          color={selected ? colors.accentTextStrong : colors.textSecondary}
        />
      </View>
      <View style={styles.cardCopy}>
        <Text variant="label" color={selected ? colors.accentTextStrong : colors.textPrimary}>
          {title}
        </Text>
        <Text variant="caption" color={colors.textSecondary}>
          {description}
        </Text>
      </View>
      {/* Always occupies its slot. Rendering the checkmark only when selected
          narrowed the copy column on tap, which re-wrapped the longer
          descriptions and changed the height of the whole page. */}
      <View style={styles.cardCheck}>
        {selected ? (
          <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
        ) : (
          <View style={styles.cardCheckEmpty} />
        )}
      </View>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  stepBody: {
    width: '100%',
    gap: spacing.lg,
  },
  preview: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  previewItem: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  previewCircleWrap: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCircleLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 28,
  },
  previewCircleNeutral: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgTertiary,
  },
  previewCircleAccent: {
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentGlow,
  },
  previewAlbumSquare: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.textTertiary,
  },
  previewNameLine: {
    width: 34,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.glassBorder,
  },
  options: {
    gap: spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 68,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  cardSelected: {
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentGlow,
  },
  cardIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgTertiary,
  },
  cardIconSelected: {
    backgroundColor: colors.bgSecondary,
  },
  cardCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  cardCheck: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardCheckEmpty: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.glassBorder,
  },
  footnote: {
    textAlign: 'center',
  },
}));

export default ArtistImageStep;
