import { View, StyleSheet } from 'react-native';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { colors, radius, spacing } from '@/theme';
import { useEQStore } from '@/stores/eqStore';

function formatFreq(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
}

export default function EQScreen() {
  const bands = useEQStore((s) => s.bands);

  return (
    <Screen>
      <Text variant="title" style={styles.heading}>
        Equalizer
      </Text>
      <Text variant="body" color={colors.textSecondary} style={styles.note}>
        The band model is in place. The Media3 biquad chain that makes these
        sliders live arrives in M4.
      </Text>

      <View style={styles.bands}>
        {bands.map((band) => (
          <View key={band.id} style={styles.band}>
            <View style={styles.track}>
              <View style={styles.knob} />
            </View>
            <Text variant="caption" style={styles.freq}>
              {formatFreq(band.frequency)}
            </Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    marginTop: spacing.xl,
  },
  note: {
    marginTop: spacing.sm,
    marginBottom: spacing.xxl,
    lineHeight: 20,
  },
  bands: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  band: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.sm,
  },
  track: {
    width: 4,
    height: 140,
    borderRadius: radius.pill,
    backgroundColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  knob: {
    width: 14,
    height: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  freq: {
    color: colors.textSecondary,
  },
});
