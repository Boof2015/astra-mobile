import {
  Pressable,
  ScrollView,
  StyleSheet
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import type { EQBand } from '@/types/audio';
import {
  formatFreq,
  formatGain,
  gainColor
} from './format';

interface BandStripProps {
  bands: EQBand[];
  activeBandId: string | null;
  canAdd: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
}

/** Horizontal strip of per-band cells (freq + gain) + a trailing "+" add cell. */
export function BandStrip({ bands, activeBandId, canAdd, onSelect, onAdd }: BandStripProps) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
    >
      {bands.map((band) => {
        const isActive = band.id === activeBandId;
        return (
          <Pressable
            key={band.id}
            onPress={() => onSelect(band.id)}
            style={[styles.cell, isActive && styles.cellActive]}
          >
            <Text variant="caption" style={styles.freq}>
              {formatFreq(band.frequency)}
            </Text>
            <Text
              variant="label"
              style={[styles.gain, { color: band.enabled ? gainColor(band.gain, colors) : colors.textTertiary }]}
            >
              {formatGain(band.gain)}
            </Text>
          </Pressable>
        );
      })}
      {canAdd ? (
        <Pressable onPress={onAdd} style={[styles.cell, styles.addCell]} accessibilityLabel="Add band">
          <Ionicons name="add" size={22} color={colors.accentText} />
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const useStyles = createThemedStyles((colors) => ({
  content: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  cell: {
    minWidth: 66,
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.glassBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  cellActive: {
    borderColor: colors.accent,
    backgroundColor: colors.glassHighlight,
  },
  addCell: {
    justifyContent: 'center',
    borderColor: colors.glassBorder,
    borderStyle: 'dashed',
    minWidth: 52,
  },
  freq: {
    color: colors.textSecondary,
  },
  gain: {
    fontSize: 15,
  },
}));

export default BandStrip;
