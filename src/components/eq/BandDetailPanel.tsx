import {
  Pressable,
  StyleSheet,
  Switch,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import type { EQBand } from '@/types/audio';
import {
  EQ_MAX_FREQUENCY,
  EQ_MAX_GAIN_DB,
  EQ_MAX_Q,
  EQ_MIN_FREQUENCY,
  EQ_MIN_Q,
  isPassEQBandType,
  isShelfEQBandType
} from '@/audio/eq';
import { EQSlider } from './EQSlider';
import {
  BAND_TYPE_LABEL,
  formatFreq,
  formatGain
} from './format';

interface BandDetailPanelProps {
  band: EQBand | null;
  bandNumber: number;
  onUpdate: (updates: Partial<EQBand>) => void;
  /** Open the filter-type picker (the sheet lives at the screen root). */
  onEditType: () => void;
  /** Open the exact value editor (the sheet lives at the screen root). */
  onEditValue: (value: EQEditableValue) => void;
}

export type EQEditableValue = 'frequency' | 'gain' | 'Q';

/** "Band N" + type dropdown + On toggle + audible parameter sliders. */
export function BandDetailPanel({ band, bandNumber, onUpdate, onEditType, onEditValue }: BandDetailPanelProps) {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  if (!band) {
    return (
      <View style={styles.card}>
        <Text variant="body" color={colors.textSecondary}>
          Select a band to edit.
        </Text>
      </View>
    );
  }

  const isPass = isPassEQBandType(band.type);
  const isShelf = isShelfEQBandType(band.type);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text variant="heading">Band {bandNumber}</Text>
        <Pressable android_ripple={ripple.bounded} style={styles.typeButton} onPress={onEditType}>
          <Text variant="label" color={colors.textPrimary}>
            {BAND_TYPE_LABEL[band.type]}
          </Text>
          <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.toggle}>
          <Text variant="label">{band.enabled ? 'On' : 'Off'}</Text>
          <Switch
            value={band.enabled}
            onValueChange={(enabled) => onUpdate({ enabled })}
            trackColor={{ false: colors.glassBorder, true: colors.accent }}
            thumbColor={colors.textPrimary}
          />
        </View>
      </View>

      <EQSlider
        label="Frequency"
        value={band.frequency}
        min={EQ_MIN_FREQUENCY}
        max={EQ_MAX_FREQUENCY}
        log
        format={(v) => `${formatFreq(v)} Hz`}
        onChange={(v) => onUpdate({ frequency: v })}
        onValuePress={() => onEditValue('frequency')}
      />
      <EQSlider
        label="Gain"
        value={isPass ? 0 : band.gain}
        min={-EQ_MAX_GAIN_DB}
        max={EQ_MAX_GAIN_DB}
        format={(v) => `${formatGain(v)} dB`}
        onChange={(v) => onUpdate({ gain: v })}
        onValuePress={() => onEditValue('gain')}
        disabled={isPass}
      />
      {!isShelf ? (
        <EQSlider
          label="Q"
          value={band.Q}
          min={EQ_MIN_Q}
          max={EQ_MAX_Q}
          log
          format={(v) => v.toFixed(2)}
          onChange={(v) => onUpdate({ Q: v })}
          onValuePress={() => onEditValue('Q')}
        />
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  typeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  toggle: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
}));

export default BandDetailPanel;
