import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { SpectrumCurve } from './SpectrumCurve';
import { colors, spacing } from '@/theme';
import { useScopeActive } from '@/scope/scopeStore';
import { useSpectrumCurve } from '@/scope/useSpectrumCurve';

const CANVAS_HEIGHT = 96;
const POINTS = 120;

type Mode = 'spectrum' | 'scope';

/**
 * Inline visualizer for the now-playing screen — no card chrome, it just lives
 * in the layout. Tap anywhere on it to switch between the live filled-line
 * Spectrum and the Scope (oscilloscope, placeholder until its native path lands).
 */
export function Visualizer({ width, height = CANVAS_HEIGHT }: { width: number; height?: number }) {
  const [mode, setMode] = useState<Mode>('spectrum');
  const scopeActive = useScopeActive();
  const spectrumActive = scopeActive && mode === 'spectrum';
  const values = useSpectrumCurve(POINTS, spectrumActive);

  const toggle = () => setMode((m) => (m === 'spectrum' ? 'scope' : 'spectrum'));

  return (
    <Pressable
      onPress={toggle}
      style={[styles.wrap, { width }]}
      accessibilityRole="button"
      accessibilityLabel={`Visualizer showing ${mode}. Tap to switch.`}
    >
      <View style={styles.caption}>
        <Text variant="caption" style={styles.captionText}>
          {mode === 'spectrum' ? 'SPECTRUM' : 'SCOPE'}
        </Text>
        <Ionicons name="swap-horizontal" size={14} color={colors.textTertiary} />
      </View>

      <View style={{ width, height }}>
        {mode === 'spectrum' ? (
          <SpectrumCurve values={values} width={width} height={height} glow />
        ) : (
          <View style={styles.placeholder}>
            <Ionicons name="pulse-outline" size={20} color={colors.textTertiary} />
            <Text variant="caption" style={styles.placeholderText}>
              OSCILLOSCOPE · COMING SOON
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: spacing.xs,
  },
  caption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  captionText: {
    color: colors.textTertiary,
    letterSpacing: 1.5,
    fontSize: 10,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  placeholderText: {
    color: colors.textTertiary,
    letterSpacing: 1.5,
    fontSize: 10,
  },
});

export default Visualizer;
