import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ActionButton } from '@/components/ActionButton';
import { AppPressable } from '@/components/AppPressable';
import { Text } from '@/components/Text';
import { playHaptic } from '@/lib/haptics';
import { useSettingsStore } from '@/stores/settingsStore';
import { fonts, radius, spacing } from '@/theme';
import { selectionSurface } from '@/theme/actionButtons';
import { createThemedStyles, useColors } from '@/theme/themed';
import type { ArtistImageAutoPolicy } from '@/types/artistImages';
import { OnboardingFrame, useOnboardingNav } from './OnboardingFrame';

const POLICY_OPTIONS: { policy: ArtistImageAutoPolicy; title: string; description: string }[] = [
  { policy: 'wifi', title: 'Wi-Fi or Ethernet', description: 'Recommended. Never uses mobile data.' },
  { policy: 'any', title: 'Any network', description: 'Includes mobile data.' },
  { policy: 'off', title: 'Off', description: 'Nothing is sent. You can still search by hand.' },
];

/**
 * The Deezer artist-photo consent. The network choice is the same decision as
 * opting in, so it is three equal options rather than a toggle plus a picker.
 * The current policy is preselected: on a consent page, "Continue" must do
 * exactly what the page shows.
 */
export function ArtistImageStep() {
  const styles = useStyles();
  const colors = useColors();
  const nav = useOnboardingNav();
  const policy = useSettingsStore((s) => s.artistImageAutoPolicy);
  const choose = (next: ArtistImageAutoPolicy) => {
    if (next === policy) return;
    playHaptic('selection');
    void useSettingsStore.getState().setArtistImageAutoPolicy(next);
  };

  return (
    <OnboardingFrame
      eyebrow="Artist portraits"
      title="Show artist photos?"
      subtitle="Astra can look up artist photos on Deezer and save them on your phone, so they work offline. Only the artist name is sent."
      footer={<ActionButton style={styles.grow} variant="primary" label="Continue" onPress={nav.next} />}
    >
      <PortraitPreview enabled={policy !== 'off'} />
      <View style={styles.options} accessibilityRole="radiogroup">
        {POLICY_OPTIONS.map((option) => {
          const selected = option.policy === policy;
          return (
            <AppPressable
              key={option.policy}
              onPress={() => choose(option.policy)}
              style={[styles.option, selected && { borderColor: colors.accent, backgroundColor: selectionSurface(colors) }]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${option.title}. ${option.description}`}
            >
              <View style={[styles.radio, selected && styles.radioSelected]}>
                {selected ? <View style={styles.radioDot} /> : null}
              </View>
              <View style={styles.optionText}>
                <Text variant="body" style={styles.optionTitle}>
                  {option.title}
                </Text>
                <Text variant="caption" color={colors.textSecondary}>
                  {option.description}
                </Text>
              </View>
            </AppPressable>
          );
        })}
      </View>
      <Text variant="caption" color={colors.textTertiary} style={styles.footnote}>
        Change this anytime in Settings › Library.
      </Text>
    </OnboardingFrame>
  );
}

/**
 * A person in a circle vs. album art in a square: the two ways an artist tile
 * can look. The tile you won't get fades back, so the preview and the options
 * always agree.
 */
function PortraitPreview({ enabled }: { enabled: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.preview} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <PreviewTile active={enabled} shape="circle" icon="person" label="With portraits" />
      <View style={styles.previewDivider} />
      <PreviewTile active={!enabled} shape="square" icon="musical-notes" label="Album art only" />
    </View>
  );
}

function PreviewTile({
  active,
  shape,
  icon,
  label,
}: {
  active: boolean;
  shape: 'circle' | 'square';
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={[styles.previewTile, !active && styles.previewTileInactive]}>
      <View
        style={[
          styles.previewShape,
          shape === 'circle' ? styles.previewCircle : styles.previewSquare,
          active && { borderColor: colors.accent, backgroundColor: selectionSurface(colors) },
        ]}
      >
        <Ionicons name={icon} size={30} color={active ? colors.accent : colors.textTertiary} />
      </View>
      <View style={styles.previewLines}>
        <View style={styles.previewLine} />
        <View style={styles.previewLineShort} />
      </View>
      <Text variant="label" color={colors.textSecondary}>
        {label}
      </Text>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  grow: {
    flex: 1,
    minHeight: 52,
  },
  preview: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
    overflow: 'hidden',
  },
  previewDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.glassBorder,
  },
  previewTile: {
    flex: 1,
    alignItems: 'center',
    gap: 10,
    paddingTop: 18,
    paddingBottom: 14,
  },
  previewTileInactive: {
    opacity: 0.42,
  },
  previewShape: {
    width: 68,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgTertiary,
  },
  previewCircle: {
    borderRadius: 34,
  },
  previewSquare: {
    borderRadius: 12,
  },
  previewLines: {
    alignItems: 'center',
    gap: 4,
  },
  previewLine: {
    width: 56,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.textTertiary,
    opacity: 0.7,
  },
  previewLineShort: {
    width: 34,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.glassBorderStrong,
  },
  options: {
    gap: spacing.sm,
    marginTop: 18,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.textTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: colors.accent,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    fontFamily: fonts.sans.medium,
  },
  footnote: {
    marginTop: spacing.lg,
  },
}));
