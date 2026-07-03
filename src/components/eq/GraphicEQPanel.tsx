import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { colors, spacing } from '@/theme';
import { EQ_MAX_GAIN_DB, EQ_MIN_GAIN_DB } from '@/audio/eq';
import { GRAPHIC_BANDS } from '@/audio/graphicEq';
import { GraphicResponseCurve } from './GraphicResponseCurve';
import { VerticalEQSlider } from './VerticalEQSlider';
import { formatFreqHz, formatGain, gainColor } from './format';

interface GraphicEQPanelProps {
  gains: number[];
  enabled: boolean;
  onChangeGain: (index: number, gainDb: number) => void;
}

/**
 * Graphic-mode editor: the response curve behind one vertical gain slider per
 * fixed band. Readouts and labels live in their own rows so the curve canvas
 * and the slider tracks share the exact same box — thumb centers sit on the
 * curve's scale. All cells are gap-less flex:1 so column centers match the
 * curve's evenly spaced band positions.
 */
export function GraphicEQPanel({ gains, enabled, onChangeGain }: GraphicEQPanelProps) {
  return (
    <View style={styles.container}>
      <View style={styles.metaRow}>
        {GRAPHIC_BANDS.map((def, i) => (
          <Text
            key={def.key}
            variant="mono"
            style={[styles.value, { color: gainColor(gains[i] ?? 0) }]}
          >
            {formatGain(gains[i] ?? 0)}
          </Text>
        ))}
      </View>

      <View style={styles.trackRow}>
        <View style={StyleSheet.absoluteFill}>
          <GraphicResponseCurve gains={gains} enabled={enabled} />
        </View>
        {GRAPHIC_BANDS.map((def, i) => (
          <VerticalEQSlider
            key={def.key}
            label={def.label}
            value={gains[i] ?? 0}
            min={EQ_MIN_GAIN_DB}
            max={EQ_MAX_GAIN_DB}
            onChange={(v) => onChangeGain(i, v)}
          />
        ))}
      </View>

      <View style={styles.metaRow}>
        {GRAPHIC_BANDS.map((def) => (
          <View key={def.key} style={styles.labelCell}>
            <Text variant="label" style={styles.centered}>
              {def.label}
            </Text>
            <Text variant="caption" style={[styles.centered, styles.caption]}>
              {formatFreqHz(def.frequency)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  metaRow: {
    flexDirection: 'row',
  },
  trackRow: {
    flex: 1,
    flexDirection: 'row',
  },
  // The row padding absorbs the fader cap's half-height overshoot (16px) at
  // the ±12 dB extremes.
  value: {
    flex: 1,
    fontSize: 12,
    textAlign: 'center',
    paddingBottom: spacing.lg,
  },
  labelCell: {
    flex: 1,
    paddingTop: spacing.lg,
  },
  centered: {
    textAlign: 'center',
  },
  caption: {
    color: colors.textTertiary,
  },
});

export default GraphicEQPanel;
