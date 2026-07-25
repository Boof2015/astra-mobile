import { processColor } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { AstraScopeView } from '../../modules/astra-scope';
import { useScopeStore } from '@/scope/scopeStore';
import { useColors } from '@/theme/themed';

interface OscilloscopeWaveProps {
  active: boolean;
  width: number;
  height: number;
  /** Live render cadence; 0 means display-sync. */
  frameMs?: number;
  color?: string;
  lineWidth?: number;
  glow?: boolean;
  edgeFade?: boolean;
  edgeFadeWidth?: number;
}

const EDGE_FADE_WIDTH = 28;

/**
 * Thin React wrapper for the native oscilloscope. Gain changes happen only at
 * track boundaries; audio frames and drawing never cross React or the JS thread.
 */
export function OscilloscopeWave({
  active,
  width,
  height,
  frameMs = 16,
  color: colorProp,
  lineWidth = 2,
  glow = false,
  edgeFade = false,
  edgeFadeWidth = EDGE_FADE_WIDTH,
}: OscilloscopeWaveProps) {
  const colors = useColors();
  const reducedMotion = useReducedMotion();
  const gain = useScopeStore((state) => state.oscGain);
  const color = processColor(colorProp ?? colors.accent);

  if (width <= 0 || height <= 0 || typeof color !== 'number') return null;
  return (
    <AstraScopeView
      mode="oscilloscope"
      source="pre"
      active={active && !reducedMotion}
      reducedMotion={reducedMotion}
      frameMs={frameMs}
      analysisFrameMs={frameMs}
      color={color}
      lineWidth={lineWidth}
      lineOpacity={1}
      fillOpacity={0}
      glow={glow}
      glowOpacity={0.18}
      edgeFade={edgeFade}
      edgeFadeWidth={edgeFadeWidth}
      gain={gain}
      pointerEvents="none"
      collapsable={false}
      style={{ width, height }}
    />
  );
}

export default OscilloscopeWave;
