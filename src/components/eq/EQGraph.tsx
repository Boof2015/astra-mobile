/* eslint-disable react-hooks/immutability, react-hooks/refs, react-hooks/purity -- Reanimated shared values are mutable gesture state, and the gesture callbacks (refs, the commit throttle's clock) run on the UI thread after render, never during it. */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  View,
  StyleSheet,
  type LayoutChangeEvent
} from 'react-native';
import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  Path,
  Skia,
  type SkPath
} from '@shopify/react-native-skia';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  type SharedValue
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Text } from '@/components/Text';
import { AppPressable } from '@/components/AppPressable';
import { SpectrumCurve } from '@/components/SpectrumCurve';
import { createThemedStyles, useColors } from '@/theme/themed';
import { playHaptic } from '@/lib/haptics';
import { isPassEQBandType } from '@/audio/eq';
import type { EQBand } from '@/types/audio';
import {
  FREQ_TICKS,
  GAIN_TICKS,
  GRAPH_PAD_Y,
  buildBandLinePath,
  buildCombinedLinePath,
  buildCurveTable,
  buildGridPaths,
  closeToBaseline,
  freqToX,
  gainToY,
  xToFreq,
  yToGain,
  type CurveTable
} from './eqGraphMath';
import {
  NODE_R,
  bandNodeGain,
  hitTestGraph,
  qAtLimit,
  qFromLineDrag,
  qLineReach,
  qLines,
  qLinesOverlap,
  quantizeFrequency,
  quantizeGain,
  type QLineSide
} from './peqGeometry';
import { bandColor, bandInk, useBandPalette } from './bandColors';
import { formatFreq } from './format';

/** Gap between the selected node and its ring. */
const RING_GAP = 6;
const Q_HANDLE_R = 6;
const Q_CAP_R = 2.5;
/** Q lines stop short of the frequency labels along the bottom edge. */
const Q_LINE_BOTTOM_INSET = 24;
const FREQ_LABEL_WIDTH = 32;
const FREQ_LABEL_INSET = 2;
/** The band marker rail under the plot. */
const RAIL_HEIGHT = 32;
const RAIL_TOUCH = 28;
const RAIL_DOT = 18;
/** Where a missing band's marks are parked — off the canvas. */
const OFFSCREEN = -1000;
/**
 * How often a drag reports to the store (and so to the audio and the band
 * panel). The graph itself redraws every frame on the UI thread regardless.
 */
const COMMIT_INTERVAL_MS = 40;

// Overlay strengths: every band shows its own shape; the selected one leads.
const FILL_ALPHA = { active: 0.26, activeOff: 0.08, other: 0.09, otherOff: 0.035 };
const LINE_ALPHA = { active: 0.85, activeOff: 0.35, other: 0.45, otherOff: 0.25 };

type BandPatch = Partial<Pick<EQBand, 'frequency' | 'gain' | 'Q'>>;

interface EQGraphProps {
  bands: EQBand[];
  activeBandId: string | null;
  enabled: boolean;
  /** Pull the live post-EQ spectrum behind the curve. */
  spectrumActive: boolean;
  onSelectBand: (id: string) => void;
  onChangeBand: (id: string, updates: BandPatch) => void;
}

type Drag =
  | {
      kind: 'node';
      id: string;
      pass: boolean;
      startX: number;
      startY: number;
      /** Whether the gain sits on the 0 dB detent — its haptic fires on entry. */
      atZero: boolean;
      lastFrequency: number;
      lastGain: number;
      moved: boolean;
    }
  | {
      kind: 'q';
      id: string;
      /** Which line is held; null until the first drag direction decides (`qLinesOverlap`). */
      side: QLineSide | null;
      start: Pick<EQBand, 'frequency' | 'Q'>;
      nodeX: number;
      startX: number;
      lastQ: number;
      /** Whether Q sits on a wall — its haptic fires on arrival. */
      atLimit: boolean;
      moved: boolean;
    };

function findBand(bands: readonly EQBand[], id: string | null): EQBand | null {
  'worklet';
  for (const band of bands) if (band.id === id) return band;
  return null;
}

function vLinePath(x: number, y0: number, y1: number): SkPath {
  'worklet';
  const p = Skia.Path.Make();
  p.moveTo(x, y0);
  p.lineTo(x, y1);
  return p;
}

/**
 * The EQ response graph, and the primary place a parametric band is edited.
 *
 * Every band draws its own response in its own color — outline plus a
 * translucent fill down to 0 dB — under the neutral combined curve, so the
 * curve reads as the sum of shapes you can see. The selected band leads: a
 * stronger fill, a ring, and (for peaking and shelf bands) a pair of Q lines at
 * its true bandwidth edges, each with a handle where the band's own curve
 * crosses it. A disabled band keeps its color, dashed, and drops out of the
 * sum. Under the plot, a rail of band markers selects bands whose nodes overlap.
 *
 * **Threading.** A drag changes what the next frame looks like, so the frame
 * can't wait on JS. `live` is a UI-thread copy of the bands: the pan gesture
 * hit-tests and edits it in worklets, and every moving mark — curves, nodes,
 * Q lines, node numbers, rail markers — is derived from it on the UI thread.
 * The store only hears about a drag every `COMMIT_INTERVAL_MS` (for the audio
 * and the panel's readouts) and once more on release. Outside a drag, `live`
 * follows the `bands` prop, so edits from the scrubbers and typed values land
 * here too. Colors and selection styling stay in React: they change on taps,
 * never mid-drag.
 */
export function EQGraph({
  bands,
  activeBandId,
  enabled,
  spectrumActive,
  onSelectBand,
  onChangeBand,
}: EQGraphProps) {
  const styles = useStyles();
  const colors = useColors();
  const palette = useBandPalette();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const width = size.width;
  const height = size.height;
  const sizeSV = useSharedValue({ width: 0, height: 0 });

  const live = useSharedValue<EQBand[]>(bands);
  const activeId = useSharedValue<string | null>(activeBandId);
  const drag = useSharedValue<Drag | null>(null);
  const lastCommitAt = useSharedValue(0);
  const draggingRef = useRef(false);
  const [draggingLine, setDraggingLine] = useState<QLineSide | null>(null);

  // While a drag owns `live`, the store's (older, throttled) copy must not
  // overwrite it; the drag's final commit brings the two back in step.
  useEffect(() => {
    if (!draggingRef.current) live.value = bands;
  }, [bands, live]);
  useEffect(() => {
    activeId.value = activeBandId;
  }, [activeBandId, activeId]);

  // The gesture is built once: replacing it mid-drag (say, because the drag
  // selected a band) would cancel the drag. Its JS callbacks read the latest
  // props through this ref instead of closing over them.
  const latest = useRef({ onSelectBand, onChangeBand, activeBandId });
  useEffect(() => {
    latest.current = { onSelectBand, onChangeBand, activeBandId };
  });

  const beginNodeDrag = useCallback((id: string) => {
    draggingRef.current = true;
    if (id !== latest.current.activeBandId) latest.current.onSelectBand(id);
  }, []);
  const beginQDrag = useCallback((side: QLineSide | null) => {
    draggingRef.current = true;
    setDraggingLine(side);
  }, []);
  const commit = useCallback((id: string, patch: BandPatch) => {
    latest.current.onChangeBand(id, patch);
  }, []);
  const endDrag = useCallback((id: string, patch: BandPatch | null) => {
    if (patch) latest.current.onChangeBand(id, patch);
    draggingRef.current = false;
    setDraggingLine(null);
  }, []);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .shouldCancelWhenOutside(false)
        .onBegin((e) => {
          'worklet';
          const w = sizeSV.value.width;
          const h = sizeSV.value.height;
          const list = live.value;
          const nodes = list.map((b) => ({
            id: b.id,
            x: freqToX(b.frequency, w),
            y: gainToY(bandNodeGain(b), h),
          }));
          const active = findBand(list, activeId.value);
          const lines = active ? qLines(active, w, h) : null;
          const hit = hitTestGraph(e.x, e.y, nodes, activeId.value, lines);
          drag.value = null;
          if (!hit) return;

          if (hit.kind === 'q') {
            if (!active || !lines) return;
            const side = qLinesOverlap(lines) ? null : hit.side;
            drag.value = {
              kind: 'q',
              id: active.id,
              side,
              start: { frequency: active.frequency, Q: active.Q },
              nodeX: freqToX(active.frequency, w),
              startX: e.x,
              lastQ: active.Q,
              atLimit: qAtLimit(active.Q),
              moved: false,
            };
            runOnJS(beginQDrag)(side);
            return;
          }

          const band = findBand(list, hit.id);
          if (!band) return;
          const gain = bandNodeGain(band);
          drag.value = {
            kind: 'node',
            id: band.id,
            pass: isPassEQBandType(band.type),
            startX: freqToX(band.frequency, w),
            startY: gainToY(gain, h),
            atZero: gain === 0,
            lastFrequency: band.frequency,
            lastGain: band.gain,
            moved: false,
          };
          activeId.value = band.id;
          runOnJS(beginNodeDrag)(band.id);
        })
        .onUpdate((e) => {
          'worklet';
          const d = drag.value;
          if (!d) return;
          const w = sizeSV.value.width;
          const h = sizeSV.value.height;
          let patch: BandPatch;

          if (d.kind === 'q') {
            let side = d.side;
            if (!side) {
              if (Math.abs(e.translationX) < 1) return;
              side = e.translationX > 0 ? 'high' : 'low';
              runOnJS(setDraggingLine)(side);
            }
            const x = d.startX + e.translationX;
            const Q = qFromLineDrag(
              d.start,
              qLineReach(side, d.startX, d.nodeX),
              qLineReach(side, x, d.nodeX),
              w
            );
            const atLimit = qAtLimit(Q);
            if (atLimit && !d.atLimit) runOnJS(playHaptic)('threshold');
            if (Q === d.lastQ) {
              if (side !== d.side || atLimit !== d.atLimit) drag.value = { ...d, side, atLimit };
              return;
            }
            drag.value = { ...d, side, lastQ: Q, atLimit, moved: true };
            patch = { Q };
          } else {
            const nx = Math.max(0, Math.min(w, d.startX + e.translationX));
            const frequency = quantizeFrequency(xToFreq(nx, w));
            let gain = d.lastGain;
            if (!d.pass) {
              const ny = Math.max(0, Math.min(h, d.startY + e.translationY));
              gain = quantizeGain(yToGain(ny, h));
            }
            if (frequency === d.lastFrequency && gain === d.lastGain) return;
            const atZero = gain === 0;
            if (!d.pass && atZero && !d.atZero) runOnJS(playHaptic)('threshold');
            drag.value = { ...d, lastFrequency: frequency, lastGain: gain, atZero, moved: true };
            patch = d.pass ? { frequency } : { frequency, gain };
          }

          // Redraw from here, this frame; tell JS at a gentler rate.
          live.value = live.value.map((b) => (b.id === d.id ? { ...b, ...patch } : b));
          const now = Date.now();
          if (now - lastCommitAt.value >= COMMIT_INTERVAL_MS) {
            lastCommitAt.value = now;
            runOnJS(commit)(d.id, patch);
          }
        })
        .onFinalize(() => {
          'worklet';
          const d = drag.value;
          drag.value = null;
          if (!d) return;
          let patch: BandPatch | null = null;
          if (d.moved) {
            if (d.kind === 'q') patch = { Q: d.lastQ };
            else patch = d.pass ? { frequency: d.lastFrequency } : { frequency: d.lastFrequency, gain: d.lastGain };
          }
          runOnJS(endDrag)(d.id, patch);
        }),
    [sizeSV, live, activeId, drag, lastCommitAt, beginNodeDrag, beginQDrag, commit, endDrag]
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const next = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
    sizeSV.value = next;
    setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
  };

  const table = useMemo(() => buildCurveTable(width), [width]);
  const grid = useMemo(() => buildGridPaths(width, height), [width, height]);
  const combinedLine = useDerivedValue(
    () => buildCombinedLinePath(live.value, table, height),
    [table, height]
  );
  const combinedFill = useDerivedValue(
    () => closeToBaseline(combinedLine.value, width, height),
    [width, height]
  );

  // With the EQ off everything still reads, but recedes.
  const dim = enabled ? 1 : 0.5;
  const curveColor = enabled ? colors.textPrimary : colors.textTertiary;
  const activeBand = bands.find((b) => b.id === activeBandId) ?? null;
  const activeColor = activeBand ? bandColor(palette, activeBand) : colors.accent;
  const drawn = width > 0 && height > 0;

  return (
    <View style={styles.root}>
      <View style={styles.plot} onLayout={onLayout}>
        {drawn ? (
          <>
            {/* Live post-EQ spectrum behind everything — neutral, so it never
                competes with the band colors. */}
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <SpectrumCurve
                source="post"
                active={spectrumActive}
                width={width}
                height={height}
                frameMs={16}
                color={colors.textSecondary}
                lineOpacity={0.14}
                fillOpacity={0.3}
                glow={false}
              />
            </View>

            <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
              {/* Log grid. */}
              <Path path={grid.minor} color={colors.glassBorder} style="stroke" strokeWidth={1} opacity={0.4} />
              <Path path={grid.major} color={colors.glassBorder} style="stroke" strokeWidth={1} />
              <Path path={grid.zero} color={colors.glassBorderStrong} style="stroke" strokeWidth={1} />

              {/* Every band's own shape; the selected one last, on top. */}
              {[...bands]
                .sort((a, b) => Number(a.id === activeBandId) - Number(b.id === activeBandId))
                .map((band) => {
                  const isActive = band.id === activeBandId;
                  const alphas = isActive
                    ? { fill: band.enabled ? FILL_ALPHA.active : FILL_ALPHA.activeOff, line: band.enabled ? LINE_ALPHA.active : LINE_ALPHA.activeOff }
                    : { fill: band.enabled ? FILL_ALPHA.other : FILL_ALPHA.otherOff, line: band.enabled ? LINE_ALPHA.other : LINE_ALPHA.otherOff };
                  return (
                    <BandShape
                      key={band.id}
                      id={band.id}
                      live={live}
                      table={table}
                      width={width}
                      height={height}
                      color={bandColor(palette, band)}
                      fillAlpha={alphas.fill}
                      lineAlpha={alphas.line}
                      lineWidth={isActive ? 1.5 : 1}
                      dashed={!band.enabled}
                      opacity={dim}
                    />
                  );
                })}

              {/* The sum — neutral, on top of the shapes it is made of. */}
              <Path path={combinedFill} color={withAlpha(curveColor, 0.04)} style="fill" />
              <Path
                path={combinedLine}
                color={curveColor}
                style="stroke"
                strokeWidth={2}
                strokeJoin="round"
                strokeCap="round"
              />

              {activeBand ? (
                <QHandles
                  id={activeBand.id}
                  live={live}
                  width={width}
                  height={height}
                  color={activeColor}
                  background={colors.bgSecondary}
                  draggingLine={draggingLine}
                  opacity={dim}
                />
              ) : null}

              {bands.map((band) => (
                <BandNode
                  key={band.id}
                  id={band.id}
                  live={live}
                  width={width}
                  height={height}
                  color={bandColor(palette, band)}
                  background={colors.bgSecondary}
                  enabled={band.enabled}
                  active={band.id === activeBandId}
                  opacity={dim}
                />
              ))}
            </Canvas>

            {/* Node numbers, riding their nodes on the UI thread. */}
            {bands.map((band, i) => (
              <NodeLabel
                key={band.id}
                id={band.id}
                live={live}
                width={width}
                height={height}
                label={String(i + 1)}
                color={band.enabled ? bandInk(palette, band) : bandColor(palette, band)}
                opacity={dim}
              />
            ))}

            {/* dB labels (right edge). */}
            {GAIN_TICKS.map((db) => (
              <Text
                key={db}
                variant="mono"
                pointerEvents="none"
                maxFontSizeMultiplier={1.2}
                style={[styles.dbLabel, { top: Math.max(1, Math.min(height - 15, gainToY(db, height) - 7)) }]}
              >
                {db > 0 ? `+${db}` : `${db}`}
              </Text>
            ))}

            {/* Frequency labels (bottom axis). */}
            {FREQ_TICKS.map((tick) => (
              <Text
                key={tick.label}
                variant="mono"
                pointerEvents="none"
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
                style={[
                  styles.freqLabel,
                  {
                    left: Math.max(FREQ_LABEL_INSET, Math.min(
                      width - FREQ_LABEL_WIDTH - FREQ_LABEL_INSET,
                      freqToX(tick.freq, width) - FREQ_LABEL_WIDTH / 2,
                    )),
                  },
                ]}
              >
                {tick.label}
              </Text>
            ))}

            <GestureDetector gesture={gesture}>
              <View style={StyleSheet.absoluteFill} />
            </GestureDetector>
          </>
        ) : null}
      </View>

      {/* Band markers at each band's frequency — how to reach a band whose node
          sits under another's. Shares the plot's width, so x lines up. */}
      <View style={styles.rail}>
        <View style={styles.railLine} />
        {drawn
          ? bands.map((band, i) => (
              <RailMarker
                key={band.id}
                id={band.id}
                live={live}
                width={width}
                label={String(i + 1)}
                color={bandColor(palette, band)}
                ink={bandInk(palette, band)}
                enabled={band.enabled}
                active={band.id === activeBandId}
                opacity={dim}
                accessibilityLabel={`Band ${i + 1}, ${formatFreq(band.frequency)} hertz${band.enabled ? '' : ', off'}`}
                onPress={() => {
                  if (band.id === activeBandId) return;
                  playHaptic('selection');
                  onSelectBand(band.id);
                }}
              />
            ))
          : null}
      </View>
    </View>
  );
}

// --- UI-thread marks -------------------------------------------------------
//
// Each reads its band out of `live` by id, so it follows a drag frame by frame
// with no React render. Styling arrives as plain props.

interface LiveProps {
  id: string;
  live: SharedValue<EQBand[]>;
  width: number;
  height: number;
}

function BandShape({
  id,
  live,
  table,
  width,
  height,
  color,
  fillAlpha,
  lineAlpha,
  lineWidth,
  dashed,
  opacity,
}: LiveProps & {
  table: CurveTable;
  color: string;
  fillAlpha: number;
  lineAlpha: number;
  lineWidth: number;
  dashed: boolean;
  opacity: number;
}) {
  const line = useDerivedValue(() => {
    const band = findBand(live.value, id);
    return band ? buildBandLinePath(band, table, height) : Skia.Path.Make();
  }, [id, table, height]);
  const fill = useDerivedValue(() => closeToBaseline(line.value, width, height), [width, height]);
  return (
    <Group opacity={opacity}>
      <Path path={fill} color={withAlpha(color, fillAlpha)} style="fill" />
      <Path path={line} color={withAlpha(color, lineAlpha)} style="stroke" strokeWidth={lineWidth} strokeJoin="round">
        {dashed ? <DashPathEffect intervals={[3, 3]} /> : null}
      </Path>
    </Group>
  );
}

function BandNode({
  id,
  live,
  width,
  height,
  color,
  background,
  enabled,
  active,
  opacity,
}: LiveProps & { color: string; background: string; enabled: boolean; active: boolean; opacity: number }) {
  const cx = useDerivedValue(() => {
    const band = findBand(live.value, id);
    return band ? freqToX(band.frequency, width) : OFFSCREEN;
  }, [id, width]);
  const cy = useDerivedValue(() => {
    const band = findBand(live.value, id);
    return band ? gainToY(bandNodeGain(band), height) : OFFSCREEN;
  }, [id, height]);
  return (
    <Group opacity={opacity}>
      {active ? <Circle cx={cx} cy={cy} r={NODE_R + RING_GAP} color={color} style="stroke" strokeWidth={2} /> : null}
      <Circle cx={cx} cy={cy} r={NODE_R} color={enabled ? color : background} />
      {enabled ? null : <Circle cx={cx} cy={cy} r={NODE_R - 1} color={color} style="stroke" strokeWidth={2} />}
    </Group>
  );
}

/** Q lines at the selected band's true bandwidth edges, a handle on its curve. */
function QHandles({
  id,
  live,
  width,
  height,
  color,
  background,
  draggingLine,
  opacity,
}: LiveProps & { color: string; background: string; draggingLine: QLineSide | null; opacity: number }) {
  const top = GRAPH_PAD_Y;
  const bottom = height - Q_LINE_BOTTOM_INSET;
  const lines = useDerivedValue(() => {
    const band = findBand(live.value, id);
    return band ? qLines(band, width, height) : null;
  }, [id, width, height]);
  return (
    <Group opacity={opacity}>
      {(['low', 'high'] as const).map((side) => (
        <QHandle
          key={side}
          side={side}
          lines={lines}
          top={top}
          bottom={bottom}
          color={color}
          background={background}
          dragging={draggingLine === side}
        />
      ))}
    </Group>
  );
}

function QHandle({
  side,
  lines,
  top,
  bottom,
  color,
  background,
  dragging,
}: {
  side: QLineSide;
  lines: SharedValue<ReturnType<typeof qLines>>;
  top: number;
  bottom: number;
  color: string;
  background: string;
  dragging: boolean;
}) {
  const x = useDerivedValue(() => lines.value?.[side]?.x ?? OFFSCREEN, [side]);
  const y = useDerivedValue(() => lines.value?.[side]?.y ?? OFFSCREEN, [side]);
  const guide = useDerivedValue(() => vLinePath(x.value, top, bottom), [top, bottom]);
  return (
    <Group>
      <Path path={guide} color={withAlpha(color, dragging ? 0.8 : 0.4)} style="stroke" strokeWidth={1}>
        <DashPathEffect intervals={[3, 4]} />
      </Path>
      <Circle cx={x} cy={top} r={Q_CAP_R} color={withAlpha(color, 0.6)} />
      <Circle cx={x} cy={bottom} r={Q_CAP_R} color={withAlpha(color, 0.6)} />
      <Circle cx={x} cy={y} r={Q_HANDLE_R} color={dragging ? color : background} />
      <Circle cx={x} cy={y} r={Q_HANDLE_R} color={color} style="stroke" strokeWidth={2} />
    </Group>
  );
}

function NodeLabel({
  id,
  live,
  width,
  height,
  label,
  color,
  opacity,
}: LiveProps & { label: string; color: string; opacity: number }) {
  const styles = useStyles();
  const position = useAnimatedStyle(() => {
    const band = findBand(live.value, id);
    return {
      transform: [
        { translateX: band ? freqToX(band.frequency, width) - NODE_R : OFFSCREEN },
        { translateY: band ? gainToY(bandNodeGain(band), height) - NODE_R : OFFSCREEN },
      ],
    };
  }, [id, width, height]);
  return (
    <Animated.View pointerEvents="none" style={[styles.nodeLabel, { opacity }, position]}>
      <Text variant="mono" maxFontSizeMultiplier={1} style={[styles.nodeLabelText, { color }]}>
        {label}
      </Text>
    </Animated.View>
  );
}

function RailMarker({
  id,
  live,
  width,
  label,
  color,
  ink,
  enabled,
  active,
  opacity,
  accessibilityLabel,
  onPress,
}: Omit<LiveProps, 'height'> & {
  label: string;
  color: string;
  ink: string;
  enabled: boolean;
  active: boolean;
  opacity: number;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  const position = useAnimatedStyle(() => {
    const band = findBand(live.value, id);
    return {
      transform: [{ translateX: (band ? freqToX(band.frequency, width) : OFFSCREEN) - RAIL_TOUCH / 2 }],
    };
  }, [id, width]);
  return (
    <Animated.View style={[styles.railTouch, position]}>
      <AppPressable
        feedback="control"
        onPress={onPress}
        style={styles.railPress}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={accessibilityLabel}
      >
        <View
          style={[
            styles.railDot,
            enabled ? { backgroundColor: color } : { borderWidth: 1.5, borderColor: color },
            active && styles.railDotActive,
            { opacity },
          ]}
        >
          <Text variant="mono" maxFontSizeMultiplier={1} style={[styles.railLabel, { color: enabled ? ink : color }]}>
            {label}
          </Text>
        </View>
        {active ? <View style={[styles.railRing, { borderColor: color }]} /> : null}
      </AppPressable>
    </Animated.View>
  );
}

// --- helpers ---------------------------------------------------------------

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const useStyles = createThemedStyles((colors) => ({
  root: {
    flex: 1,
  },
  plot: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.bgSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  nodeLabel: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: NODE_R * 2,
    height: NODE_R * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeLabelText: {
    fontSize: 11,
    lineHeight: 14,
  },
  dbLabel: {
    position: 'absolute',
    right: 6,
    fontSize: 9,
    lineHeight: 14,
    color: colors.textSecondary,
  },
  freqLabel: {
    position: 'absolute',
    bottom: 4,
    width: FREQ_LABEL_WIDTH,
    textAlign: 'center',
    fontSize: 9,
    lineHeight: 14,
    color: colors.textSecondary,
  },
  rail: {
    height: RAIL_HEIGHT,
    justifyContent: 'center',
  },
  railLine: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.glassBorder,
  },
  railTouch: {
    position: 'absolute',
    left: 0,
    top: (RAIL_HEIGHT - RAIL_TOUCH) / 2,
    width: RAIL_TOUCH,
    height: RAIL_TOUCH,
  },
  railPress: {
    width: RAIL_TOUCH,
    height: RAIL_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railDot: {
    width: RAIL_DOT,
    height: RAIL_DOT,
    borderRadius: RAIL_DOT / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railDotActive: {
    transform: [{ scale: 1.15 }],
  },
  railRing: {
    position: 'absolute',
    width: RAIL_TOUCH,
    height: RAIL_TOUCH,
    borderRadius: RAIL_TOUCH / 2,
    borderWidth: 1.5,
  },
  railLabel: {
    fontSize: 10,
    lineHeight: 12,
  },
}));

export default EQGraph;
