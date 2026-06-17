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

interface VisualizerProps {
  width: number;
  height?: number;
  interactive?: boolean;
  showChrome?: boolean;
  mode?: Mode;
}

/**
 * Visualizer for the now-playing screen. By default it remains an inline
 * interactive component; inside the media stage it can render chrome-free so
 * the parent owns artwork/scope switching without moving the surrounding UI.
 */
export function Visualizer({
  width,
  height = CANVAS_HEIGHT,
  interactive = true,
  showChrome = true,
  mode: controlledMode,
}: VisualizerProps) {
  const [uncontrolledMode, setUncontrolledMode] = useState<Mode>('spectrum');
  const mode = controlledMode ?? uncontrolledMode;
  const scopeActive = useScopeActive();
  const spectrumActive = scopeActive && mode === 'spectrum';
  const values = useSpectrumCurve(POINTS, spectrumActive);

  const toggle = () => {
    if (controlledMode) return;
    setUncontrolledMode((m) => (m === 'spectrum' ? 'scope' : 'spectrum'));
  };

  const content = (
    <>
      {showChrome && (
        <View style={styles.caption}>
          <Text variant="caption" style={styles.captionText}>
            {mode === 'spectrum' ? 'SPECTRUM' : 'SCOPE'}
          </Text>
          <Ionicons name="swap-horizontal" size={14} color={colors.textTertiary} />
        </View>
      )}

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
    </>
  );

  if (!interactive) {
    return (
      <View pointerEvents="none" style={[styles.stageWrap, { width, height }]}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={toggle}
      style={[styles.wrap, { width }]}
      accessibilityRole="button"
      accessibilityLabel={`Visualizer showing ${mode}. Tap to switch.`}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: spacing.xs,
  },
  stageWrap: {
    overflow: 'hidden',
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
