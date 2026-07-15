import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  SettingsCard,
  SettingsSectionLabel,
  SettingsSectionScreen,
} from '@/components/settings/SettingsSectionScaffold';
import { Text } from '@/components/Text';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import { playHaptic, type HapticEvent } from '@/lib/haptics';
import {
  HAPTIC_RECIPE_SECTIONS,
  canPlayHapticRecipe,
  unsupportedRecipePrimitives,
} from '@/lib/hapticRecipes';
import {
  AstraHaptics,
  type HapticCapabilities,
  type HapticCompositionStep,
  type HapticPrimitive,
} from '../../../modules/astra-haptics';

const SEMANTIC_EVENTS: {
  event: HapticEvent;
  label: string;
  description: string;
}[] = [
  { event: 'toggleOn', label: 'Toggle on', description: 'A setting enters its active state.' },
  { event: 'toggleOff', label: 'Toggle off', description: 'A setting leaves its active state.' },
  { event: 'selection', label: 'Selection', description: 'A discrete choice changes.' },
  { event: 'frequentStep', label: 'Frequent step', description: 'A repeated row or letter crossing.' },
  { event: 'scrubStep', label: 'Scrub step', description: 'A fine seek detent passes under the finger.' },
  { event: 'threshold', label: 'Threshold', description: 'A gesture becomes armed.' },
  { event: 'action', label: 'Action', description: 'A direct control commits.' },
  { event: 'dragStart', label: 'Drag start', description: 'An item is picked up.' },
  { event: 'dragEnd', label: 'Drag end', description: 'An item is released.' },
  { event: 'confirm', label: 'Confirm', description: 'An operation succeeds.' },
  { event: 'reject', label: 'Reject', description: 'An operation is rejected.' },
];

const PRIMITIVES: { primitive: HapticPrimitive; label: string }[] = [
  { primitive: 'click', label: 'Click' },
  { primitive: 'tick', label: 'Tick' },
  { primitive: 'lowTick', label: 'Low tick' },
  { primitive: 'thud', label: 'Thud' },
  { primitive: 'quickRise', label: 'Quick rise' },
  { primitive: 'slowRise', label: 'Slow rise' },
  { primitive: 'quickFall', label: 'Quick fall' },
  { primitive: 'spin', label: 'Spin' },
];

const SCALES = [0.5, 0.7, 1] as const;

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}

export default function HapticsLabScreen() {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  const [capabilities, setCapabilities] = useState<HapticCapabilities>(() =>
    AstraHaptics.getCapabilities()
  );
  const [status, setStatus] = useState<string | null>(null);

  const refresh = () => {
    setCapabilities(AstraHaptics.getCapabilities());
    setStatus(null);
  };

  const playComposition = (steps: readonly HapticCompositionStep[], label: string) => {
    const played = AstraHaptics.playComposition(steps.map((step) => ({ ...step })));
    setStatus(played ? `Played ${label}.` : `${label} could not play on this device.`);
  };

  return (
    <SettingsSectionScreen title="Haptics Lab">
      <Text variant="caption" color={colors.textSecondary} style={styles.intro}>
        Audition Android&apos;s semantic feedback and Astra&apos;s shared composition
        candidates. Timing calibration is recorded; the recipes below are ready for a
        fresh vote. Custom candidates are not wired into production gestures yet.
      </Text>

      <SettingsSectionLabel>DEVICE</SettingsSectionLabel>
      <SettingsCard>
        <CapabilityRow label="Native module" value={yesNo(capabilities.moduleAvailable)} />
        <CapabilityRow label="Android API" value={String(capabilities.apiLevel)} />
        <CapabilityRow label="Vibrator" value={yesNo(capabilities.hasVibrator)} />
        <CapabilityRow
          label="Amplitude control"
          value={yesNo(capabilities.hasAmplitudeControl)}
        />
        <CapabilityRow
          label="Touch feedback enabled"
          value={yesNo(capabilities.touchFeedbackEnabled)}
        />
        <Pressable
          android_ripple={ripple.bounded}
          style={styles.refreshButton}
          onPress={refresh}
          accessibilityRole="button"
        >
          <Text variant="label" color={colors.accentTextStrong}>Refresh capabilities</Text>
        </Pressable>
      </SettingsCard>

      <SettingsSectionLabel spaced>SEMANTIC VOCABULARY</SettingsSectionLabel>
      <SettingsCard style={styles.stack}>
        {SEMANTIC_EVENTS.map(({ event, label, description }) => (
          <View key={event} style={styles.auditionRow}>
            <View style={styles.rowCopy}>
              <Text variant="body">{label}</Text>
              <Text variant="caption" color={colors.textSecondary}>{description}</Text>
            </View>
            <AuditionButton label="Feel" onPress={() => playHaptic(event)} />
          </View>
        ))}
      </SettingsCard>

      <SettingsSectionLabel spaced>PRIMITIVES</SettingsSectionLabel>
      <SettingsCard style={styles.stack}>
        {PRIMITIVES.map(({ primitive, label }) => {
          const capability = capabilities.primitives[primitive];
          return (
            <View key={primitive} style={styles.primitiveBlock}>
              <View style={styles.primitiveHeading}>
                <Text variant="body">{label}</Text>
                <Text variant="caption" color={colors.textSecondary}>
                  {capability.supported
                    ? capability.durationMs > 0
                      ? `${capability.durationMs} ms`
                      : 'Supported'
                    : 'Unsupported'}
                </Text>
              </View>
              <View style={styles.buttonRow}>
                {SCALES.map((scale) => (
                  <AuditionButton
                    key={scale}
                    label={scale.toFixed(1)}
                    disabled={!capability.supported || !capabilities.touchFeedbackEnabled}
                    onPress={() =>
                      playComposition([{ primitive, scale, delayMs: 0 }], `${label} ${scale}`)
                    }
                  />
                ))}
              </View>
            </View>
          );
        })}
      </SettingsCard>

      {HAPTIC_RECIPE_SECTIONS.map((section) => (
        <View key={section.id} style={styles.recipeSection}>
          <SettingsSectionLabel spaced>{section.label}</SettingsSectionLabel>
          <Text variant="caption" color={colors.textSecondary} style={styles.sectionIntro}>
            {section.description}
          </Text>
          {section.groups.map((group) => {
            const leadingCandidate = group.candidates.find(
              (candidate) => candidate.id === group.leadingCandidateId
            );
            return (
              <SettingsCard key={group.id} style={styles.recipeCard}>
                <Text variant="heading">{group.label}</Text>
                <Text variant="caption" color={colors.textSecondary}>{group.description}</Text>
                {leadingCandidate ? (
                  <Text variant="label" color={colors.accentTextStrong}>
                    {section.id === 'timing'
                      ? 'Selected calibration'
                      : group.selectionStatus === 'provisional'
                        ? 'Provisional choice'
                        : 'Selected candidate'}{' '}
                    · {leadingCandidate.label}
                  </Text>
                ) : null}
                <View style={styles.recipeButtons}>
                  {group.candidates.map((candidate) => {
                    const unsupported = unsupportedRecipePrimitives(
                      candidate.steps,
                      capabilities
                    );
                    const enabled = canPlayHapticRecipe(candidate.steps, capabilities);
                    return (
                      <View key={candidate.id} style={styles.recipeCandidate}>
                        <AuditionButton
                          label={
                            group.id === 'holdAccepted'
                              ? `Hold · ${candidate.label}`
                              : candidate.label
                          }
                          disabled={!enabled}
                          wide
                          onPress={
                            group.id === 'holdAccepted'
                              ? undefined
                              : () => playComposition(candidate.steps, candidate.label)
                          }
                          onLongPress={
                            group.id === 'holdAccepted'
                              ? () => playComposition(candidate.steps, candidate.label)
                              : undefined
                          }
                        />
                        {!enabled ? (
                          <Text variant="caption" color={colors.textTertiary}>
                            {unsupported.length > 0
                              ? `Needs ${unsupported.join(', ')}`
                              : capabilities.touchFeedbackEnabled
                                ? 'Unavailable'
                                : 'Touch feedback is off'}
                          </Text>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </SettingsCard>
            );
          })}
        </View>
      ))}

      {status ? (
        <Text variant="caption" color={colors.textSecondary} style={styles.status}>
          {status}
        </Text>
      ) : null}
    </SettingsSectionScreen>
  );
}

function CapabilityRow({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.capabilityRow}>
      <Text variant="body">{label}</Text>
      <Text variant="label" color={colors.textSecondary}>{value}</Text>
    </View>
  );
}

function AuditionButton({
  label,
  disabled = false,
  wide = false,
  onPress,
  onLongPress,
}: {
  label: string;
  disabled?: boolean;
  wide?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  return (
    <Pressable
      android_ripple={ripple.bounded}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={500}
      style={[styles.auditionButton, wide && styles.wideButton, disabled && styles.disabled]}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
    >
      <Text variant="label" color={disabled ? colors.textTertiary : colors.accentTextStrong}>
        {label}
      </Text>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  intro: {
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  stack: {
    gap: spacing.lg,
  },
  capabilityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  refreshButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
    backgroundColor: colors.glassHighlight,
  },
  auditionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  primitiveBlock: {
    gap: spacing.sm,
  },
  primitiveHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  auditionButton: {
    minWidth: 62,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
    backgroundColor: colors.glassHighlight,
  },
  wideButton: {
    alignSelf: 'stretch',
  },
  disabled: {
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgTertiary,
    opacity: 0.65,
  },
  recipeCard: {
    gap: spacing.sm,
  },
  recipeSection: {
    gap: spacing.md,
  },
  sectionIntro: {
    lineHeight: 18,
  },
  recipeButtons: {
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  recipeCandidate: {
    gap: spacing.xs,
  },
  status: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
}));
