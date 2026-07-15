import { useState } from 'react';
import {
  Pressable,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { SpectrumCurve } from './SpectrumCurve';
import { OscilloscopeWave } from './OscilloscopeWave';
import { spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useScopeActive } from '@/scope/scopeStore';

const CANVAS_HEIGHT = 96;
// 60fps cap: display-sync (0) pinned the JS thread at 120Hz on high-refresh
// devices and starved every other animation.
const STAGE_FRAME_MS = 16;

type Mode = 'spectrum' | 'scope';

interface VisualizerProps {
  width: number;
  height?: number;
  interactive?: boolean;
  showChrome?: boolean;
  mode?: Mode;
  edgeFade?: boolean;
  spectrumSmoothing?: number;
  /** Freeze the live scopes without unmounting (e.g. while occluded by an overlay). */
  paused?: boolean;
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
  edgeFade = false,
  spectrumSmoothing,
  paused = false,
}: VisualizerProps) {
  const styles = useStyles();
  const colors = useColors();
  const [uncontrolledMode, setUncontrolledMode] = useState<Mode>('spectrum');
  const mode = controlledMode ?? uncontrolledMode;
  const scopeActive = useScopeActive() && !paused;
  const spectrumActive = scopeActive && mode === 'spectrum';
  const scopeWaveActive = scopeActive && mode === 'scope';

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
          <SpectrumCurve
            active={spectrumActive}
            frameMs={STAGE_FRAME_MS}
            smoothing={spectrumSmoothing}
            width={width}
            height={height}
            glow
            edgeFade={edgeFade}
          />
        ) : (
          <OscilloscopeWave
            active={scopeWaveActive}
            frameMs={STAGE_FRAME_MS}
            width={width}
            height={height}
            glow
            edgeFade={edgeFade}
          />
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

const useStyles = createThemedStyles((colors) => ({
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
}));

export default Visualizer;
