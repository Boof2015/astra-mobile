import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { HapticSwitch } from '@/components/HapticSwitch';
import { AppPressable } from '@/components/AppPressable';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { isPassEQBandType } from '@/audio/eq';
import type { EQBand } from '@/types/audio';
import { ParamScrubber } from './ParamScrubber';
import { bandColor, bandColorName, bandInk, useBandPalette } from './bandColors';
import { BAND_TYPE_LABEL, formatFreqExact, formatGain } from './format';

export type EQEditableValue = 'frequency' | 'gain' | 'Q';

/** Add / remove band buttons, and the color badge. */
const ICON_BUTTON = 36;
const BADGE = 32;

interface BandEditorPanelProps {
  band: EQBand | null;
  bandNumber: number;
  canAdd: boolean;
  canRemove: boolean;
  onUpdate: (updates: Partial<EQBand>) => void;
  onAdd: () => void;
  onRemove: () => void;
  /** Open the filter-type picker (the sheet lives at the screen root). */
  onEditType: () => void;
  /** Open the band color picker (the sheet lives at the screen root). */
  onEditColor: () => void;
  /** Open the exact value editor (the sheet lives at the screen root). */
  onEditValue: (value: EQEditableValue) => void;
}

/**
 * The selected band, under the graph: its type, add/remove, on/off, then
 * Frequency | Q | Gain. Each parameter can be dragged on the graph, scrubbed
 * here, or tapped and typed — all three write the same store band, so none of
 * them is a separate mode. Selection happens on the graph; there is no chip
 * strip to pick a band from.
 *
 * Its height is fixed by its contents, never measured or flexed: the graph above
 * is the screen's one elastic region.
 */
export function BandEditorPanel({
  band,
  bandNumber,
  canAdd,
  canRemove,
  onUpdate,
  onAdd,
  onRemove,
  onEditType,
  onEditColor,
  onEditValue,
}: BandEditorPanelProps) {
  const styles = useStyles();
  const colors = useColors();
  const palette = useBandPalette();

  const addButton = (
    <IconButton icon="add" label="Add band" disabled={!canAdd} onPress={onAdd} />
  );

  if (!band) {
    return (
      <View style={[styles.card, styles.emptyCard]}>
        <Text variant="body" color={colors.textSecondary} style={styles.emptyText}>
          Tap a point on the graph to edit it.
        </Text>
        {addButton}
      </View>
    );
  }

  const isPass = isPassEQBandType(band.type);
  const tint = bandColor(palette, band);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        {/* The band's number in its color; tap to recolor. */}
        <AppPressable
          feedback="control"
          style={[styles.badge, { backgroundColor: band.enabled ? tint : 'transparent', borderColor: tint }]}
          onPress={onEditColor}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`Band ${bandNumber} color, ${bandColorName(band)}`}
        >
          <Text
            variant="mono"
            maxFontSizeMultiplier={1}
            style={[styles.badgeText, { color: band.enabled ? bandInk(palette, band) : tint }]}
          >
            {bandNumber}
          </Text>
        </AppPressable>
        <AppPressable
          feedback="control"
          style={styles.typeButton}
          onPress={onEditType}
          accessibilityRole="button"
          accessibilityLabel={`Band ${bandNumber} filter type, ${BAND_TYPE_LABEL[band.type]}`}
        >
          <Text variant="label" color={colors.textPrimary} numberOfLines={1} style={styles.typeText}>
            {BAND_TYPE_LABEL[band.type]}
          </Text>
          <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
        </AppPressable>
        <View style={styles.headerActions}>
          <IconButton
            icon="remove"
            label={`Remove band ${bandNumber}`}
            disabled={!canRemove}
            onPress={onRemove}
          />
          {addButton}
          <HapticSwitch
            value={band.enabled}
            onValueChange={(enabled) => onUpdate({ enabled })}
            trackColor={{ false: colors.glassBorder, true: tint }}
            thumbColor={colors.textPrimary}
            accessibilityLabel={`Band ${bandNumber} ${band.enabled ? 'on' : 'off'}`}
          />
        </View>
      </View>

      <View style={styles.params}>
        <ParamScrubber
          label="Frequency"
          param="frequency"
          value={band.frequency}
          format={(v) => `${formatFreqExact(v)} Hz`}
          onChange={(frequency) => onUpdate({ frequency })}
          onValuePress={() => onEditValue('frequency')}
          tint={tint}
        />
        <ParamScrubber
          label="Q"
          param="Q"
          value={band.Q}
          format={(v) => v.toFixed(2)}
          onChange={(Q) => onUpdate({ Q })}
          onValuePress={() => onEditValue('Q')}
          tint={tint}
        />
        <ParamScrubber
          label="Gain"
          param="gain"
          value={isPass ? 0 : band.gain}
          format={(v) => `${formatGain(v)} dB`}
          onChange={(gain) => onUpdate({ gain })}
          onValuePress={() => onEditValue('gain')}
          disabled={isPass}
          tint={tint}
        />
      </View>
    </View>
  );
}

function IconButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'add' | 'remove';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <AppPressable
      feedback="control"
      disabled={disabled}
      style={[styles.iconButton, disabled && styles.iconButtonDisabled]}
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={20} color={colors.textSecondary} />
    </AppPressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    backgroundColor: colors.bgSecondary,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  emptyText: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  typeButton: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    height: ICON_BUTTON,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    backgroundColor: colors.bgTertiary,
  },
  badge: {
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 13,
    lineHeight: 16,
  },
  typeText: {
    flexShrink: 1,
  },
  headerActions: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  iconButton: {
    width: ICON_BUTTON,
    height: ICON_BUTTON,
    borderRadius: ICON_BUTTON / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  iconButtonDisabled: {
    opacity: 0.35,
  },
  params: {
    flexDirection: 'row',
    gap: spacing.md,
  },
}));

export default BandEditorPanel;
