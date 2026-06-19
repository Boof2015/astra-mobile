import { useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  Path,
  Skia,
  type SkPath,
} from '@shopify/react-native-skia';
import { Text } from '@/components/Text';
import { SpectrumCurve } from '@/components/SpectrumCurve';
import { colors } from '@/theme';
import type { EQBand } from '@/types/audio';
import {
  FREQ_TICKS,
  buildResponseFill,
  buildResponsePath,
  freqToX,
  gainToY,
  xToFreq,
  yToGain,
} from './eqGraphMath';

const HIT_RADIUS = 34;
const NODE_R = 13;

interface EQGraphProps {
  bands: EQBand[];
  activeBandId: string | null;
  enabled: boolean;
  /** Pull the live post-EQ spectrum behind the curve. */
  spectrumActive: boolean;
  onSelectBand: (id: string) => void;
  onChangeBand: (id: string, updates: { frequency: number; gain: number }) => void;
}

/**
 * The EQ response graph: a live post-EQ spectrum behind a draggable response curve
 * with one numbered node per band. Skia draws the curve/grid/nodes; a transparent
 * RN responder maps touches to the nearest node and drags it (x → frequency, y →
 * gain). Q is edited from the detail panel, not the curve.
 */
export function EQGraph({
  bands,
  activeBandId,
  enabled,
  spectrumActive,
  onSelectBand,
  onChangeBand,
}: EQGraphProps) {
  const [size, setSize] = useStableSize();
  const width = size.width;
  const height = size.height;

  // Anchor the grabbed node + grant page coords; move by absolute page deltas
  // (clamped to the graph) so veering off-bounds can't snap to a corner.
  const dragRef = useRef<{
    id: string;
    pageX: number;
    pageY: number;
    startX: number;
    startY: number;
  } | null>(null);

  const linePath = useMemo(
    () => buildResponsePath(bands, width, height),
    [bands, width, height]
  );
  const fillPath = useMemo(
    () => buildResponseFill(linePath, width, height),
    [linePath, width, height]
  );

  const onLayout = (e: LayoutChangeEvent) => {
    setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
  };

  const nearestBandId = (x: number, y: number): string | null => {
    let best: string | null = null;
    let bestDist = HIT_RADIUS * HIT_RADIUS;
    for (const band of bands) {
      const bx = freqToX(band.frequency, width);
      const by = gainToY(band.gain, height);
      const d = (bx - x) ** 2 + (by - y) ** 2;
      if (d <= bestDist) {
        bestDist = d;
        best = band.id;
      }
    }
    return best;
  };

  const handleGrant = (e: GestureResponderEvent) => {
    const { locationX, locationY, pageX, pageY } = e.nativeEvent;
    const id = nearestBandId(locationX, locationY);
    if (!id) {
      dragRef.current = null;
      return;
    }
    const band = bands.find((b) => b.id === id);
    if (!band) return;
    dragRef.current = {
      id,
      pageX,
      pageY,
      startX: freqToX(band.frequency, width),
      startY: gainToY(band.gain, height),
    };
    onSelectBand(id);
  };

  const handleMove = (e: GestureResponderEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const { pageX, pageY } = e.nativeEvent;
    const nx = Math.max(0, Math.min(width, d.startX + (pageX - d.pageX)));
    const ny = Math.max(0, Math.min(height, d.startY + (pageY - d.pageY)));
    onChangeBand(d.id, { frequency: xToFreq(nx, width), gain: yToGain(ny, height) });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const curveColor = enabled ? colors.accent : colors.textTertiary;
  const centerY = height / 2;
  const yPlus6 = gainToY(6, height);
  const yMinus6 = gainToY(-6, height);

  return (
    <View style={styles.container} onLayout={onLayout}>
      {width > 0 && height > 0 ? (
        <>
          {/* Live post-EQ spectrum behind the curve. */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <SpectrumCurve
              source="post"
              active={spectrumActive}
              width={width}
              height={height}
              frameMs={0}
              color={colors.accent}
              lineOpacity={0.22}
              fillOpacity={0.5}
              glow={false}
            />
          </View>

          <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
            {/* Grid: ±6 dB lines + dashed 0 dB centerline. */}
            <Group>
              <Path
                path={hLine(0, yPlus6, width)}
                color={colors.glassBorder}
                style="stroke"
                strokeWidth={1}
              />
              <Path
                path={hLine(0, yMinus6, width)}
                color={colors.glassBorder}
                style="stroke"
                strokeWidth={1}
              />
              <Path path={hLine(0, centerY, width)} color={colors.glassBorder} style="stroke" strokeWidth={1}>
                <DashPathEffect intervals={[3, 5]} />
              </Path>
            </Group>

            {/* Response curve + soft fill. */}
            <Path path={fillPath} color={withAlpha(curveColor, 0.1)} style="fill" />
            <Path
              path={linePath}
              color={curveColor}
              style="stroke"
              strokeWidth={2}
              strokeJoin="round"
              strokeCap="round"
            />

            {/* Band nodes. */}
            {bands.map((band) => {
              const cx = freqToX(band.frequency, width);
              const cy = gainToY(band.gain, height);
              const isActive = band.id === activeBandId;
              const dim = !band.enabled || !enabled;
              return (
                <Group key={band.id}>
                  <Circle
                    cx={cx}
                    cy={cy}
                    r={NODE_R}
                    color={isActive ? colors.accent : colors.bgTertiary}
                    opacity={dim ? 0.4 : 1}
                  />
                  <Circle
                    cx={cx}
                    cy={cy}
                    r={NODE_R}
                    color={isActive ? colors.accent : colors.glassBorder}
                    style="stroke"
                    strokeWidth={isActive ? 0 : 1.5}
                    opacity={dim ? 0.5 : 1}
                  />
                </Group>
              );
            })}
          </Canvas>

          {/* Node numbers (RN text over the canvas). */}
          {bands.map((band, i) => {
            const cx = freqToX(band.frequency, width);
            const cy = gainToY(band.gain, height);
            const isActive = band.id === activeBandId;
            return (
              <Text
                key={band.id}
                variant="caption"
                pointerEvents="none"
                style={[
                  styles.nodeLabel,
                  { left: cx - NODE_R, top: cy - 8 },
                  { color: isActive ? colors.accentTextStrong : colors.textSecondary },
                ]}
              >
                {i + 1}
              </Text>
            );
          })}

          {/* dB labels (right edge). */}
          <Text variant="caption" pointerEvents="none" style={[styles.dbLabel, { top: yPlus6 - 6 }]}>
            +6
          </Text>
          <Text variant="caption" pointerEvents="none" style={[styles.dbLabel, { top: yMinus6 - 6 }]}>
            -6
          </Text>

          {/* Frequency labels (bottom axis). */}
          {FREQ_TICKS.map((tick) => (
            <Text
              key={tick.label}
              variant="caption"
              pointerEvents="none"
              style={[styles.freqLabel, { left: freqToX(tick.freq, width) - 10 }]}
            >
              {tick.label}
            </Text>
          ))}

          {/* Gesture overlay. */}
          <View
            style={StyleSheet.absoluteFill}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderTerminationRequest={() => false}
            onResponderGrant={handleGrant}
            onResponderMove={handleMove}
            onResponderRelease={endDrag}
            onResponderTerminate={endDrag}
          />
        </>
      ) : null}
    </View>
  );
}

// --- helpers ---------------------------------------------------------------

function hLine(x0: number, y: number, width: number): SkPath {
  const p = Skia.Path.Make();
  p.moveTo(x0, y);
  p.lineTo(width, y);
  return p;
}

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function useStableSize(): [
  { width: number; height: number },
  (s: { width: number; height: number }) => void,
] {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const set = (s: { width: number; height: number }) => {
    setSize((prev) => (prev.width === s.width && prev.height === s.height ? prev : s));
  };
  return [size, set];
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.bgSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  nodeLabel: {
    position: 'absolute',
    width: NODE_R * 2,
    textAlign: 'center',
    fontSize: 12,
  },
  dbLabel: {
    position: 'absolute',
    right: 8,
    color: colors.textTertiary,
  },
  freqLabel: {
    position: 'absolute',
    bottom: 4,
    width: 20,
    textAlign: 'center',
    color: colors.textTertiary,
  },
});

export default EQGraph;
