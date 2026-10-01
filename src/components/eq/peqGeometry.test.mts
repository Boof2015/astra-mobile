import assert from 'node:assert/strict';
import test from 'node:test';
import type { EQBand } from '../../types/audio.ts';
import { EQ_MAX_Q, EQ_MIN_Q, computeEQFilterMagnitude } from '../../audio/eq.ts';
import {
  GRAPH_SAMPLE_RATE,
  NODE_HIT_RADIUS,
  Q_DRAG_DP_PER_DOUBLING,
  Q_DRAG_FLOOR,
  Q_LINE_HIT_HALF,
  bandEdges,
  bandNodeGain,
  bandwidthOctaves,
  freqToX,
  gainToY,
  hitTestGraph,
  paramFraction,
  pxPerOctave,
  qDragOffset,
  qFromBandwidth,
  qFromDragOffset,
  qAtLimit,
  qFromLineDrag,
  qLineReach,
  qLines,
  qLinesOverlap,
  quantizeGain,
  scrubValue,
  stepValue,
} from './peqGeometry.ts';

/** A phone graph, inset-adjusted. */
const W = 360;
const H = 300;

function band(overrides: Partial<EQBand> = {}): EQBand {
  return { id: 'b', type: 'peaking', frequency: 1000, gain: 6, Q: 1, enabled: true, ...overrides };
}

test('Q and bandwidth round-trip across the whole Q range, warped or not', () => {
  for (const Q of [EQ_MIN_Q, 0.3, 0.707, 1, 1.41, 4, 10, EQ_MAX_Q]) {
    assert.ok(Math.abs(qFromBandwidth(bandwidthOctaves(Q)) - Q) < 1e-9, `Q ${Q}`);
    for (const f of [60, 1000, 12000]) {
      assert.ok(Math.abs(qFromBandwidth(bandwidthOctaves(Q, f), f) - Q) < 1e-9, `Q ${Q} @ ${f}`);
    }
  }
  // Q ≈ 1.41 is the classic one-octave band.
  assert.ok(Math.abs(bandwidthOctaves(1.4142) - 1) < 1e-3);
  assert.equal(qFromBandwidth(0), EQ_MAX_Q);
});

// Exact for ordinary widths. Very wide bands, and bands near Nyquist, lose the
// digital response's symmetry and drift off half gain by a fraction of a dB —
// which is why the handles take their height from the curve, not from gain / 2.
test('a peaking band\'s edges sit where its own curve is at half its gain', () => {
  for (const b of [
    band({ frequency: 1000, gain: 6, Q: 1.41 }),
    band({ frequency: 100, gain: -8, Q: 4 }),
    band({ frequency: 8000, gain: 6, Q: EQ_MAX_Q }),
    band({ frequency: 250, gain: 3, Q: 0.7 }),
  ]) {
    const { low, high } = bandEdges(b);
    for (const f of [low, high]) {
      const db = computeEQFilterMagnitude(b, f, GRAPH_SAMPLE_RATE);
      assert.ok(Math.abs(db - b.gain / 2) < 0.1, `${b.frequency} Hz Q ${b.Q}: ${db} dB`);
    }
  }
});

test('Q lines are drawn at the true edges, each handle on the band curve', () => {
  const b = band({ frequency: 1000, gain: 6, Q: 1.41 });
  const lines = qLines(b, W, H)!;
  const { low, high } = bandEdges(b);
  assert.ok(lines.low && lines.high);
  assert.equal(lines.low.x, freqToX(low, W));
  assert.equal(lines.high.x, freqToX(high, W));
  assert.equal(lines.low.y, gainToY(computeEQFilterMagnitude(b, low, GRAPH_SAMPLE_RATE), H));
  // Half the gain: halfway between the 0 dB line and the node.
  assert.ok(Math.abs(lines.high.y - (gainToY(0, H) + gainToY(6, H)) / 2) < 1);
});

test('pass filters have no Q lines; shelves do', () => {
  assert.equal(qLines(band({ type: 'highpass', frequency: 80, Q: 0.707 }), W, H), null);
  assert.equal(qLines(band({ type: 'lowpass', frequency: 8000, Q: 0.707 }), W, H), null);
  assert.ok(qLines(band({ type: 'lowshelf', frequency: 100, Q: 0.707 }), W, H));
  assert.ok(qLines(band({ type: 'highshelf', frequency: 8000, Q: 0.707 }), W, H));
});

test('a Q line that falls off the graph is dropped, the other stays', () => {
  const lines = qLines(band({ frequency: 30, Q: EQ_MIN_Q }), W, H)!;
  assert.equal(lines.low, null);
  assert.notEqual(lines.high, null);
});

test('the Q drag space inverts, and spreads narrow bands evenly', () => {
  for (const f of [100, 1000, 12000]) {
    let prev = -Infinity;
    for (let lnQ = Math.log(EQ_MAX_Q); lnQ >= Math.log(EQ_MIN_Q); lnQ -= 0.05) {
      const Q = Math.exp(lnQ);
      const d = qDragOffset(Q, f, W);
      assert.ok(d > prev, `Q ${Q} @ ${f}`);
      prev = d;
      assert.ok(Math.abs(qFromDragOffset(d, f, W) - Q) / Q < 1e-9, `Q ${Q} @ ${f}`);
    }
  }
  assert.equal(qDragOffset(EQ_MAX_Q, 1000, W), Q_DRAG_FLOOR);
  const step = qDragOffset(9, 1000, W) - qDragOffset(18, 1000, W);
  assert.ok(Math.abs(step - Q_DRAG_DP_PER_DOUBLING) < 1e-9);
  // Wide bands drag at their true edges: the finger stays on the line.
  const trueHalf = (bandwidthOctaves(EQ_MIN_Q, 1000) / 2) * pxPerOctave(W);
  assert.equal(qDragOffset(EQ_MIN_Q, 1000, W), trueHalf);
});

test('moving away from the node lowers Q, toward it raises it, and it clamps', () => {
  const start = { frequency: 1000, Q: 1 };
  assert.equal(qFromLineDrag(start, 40, 40, W), 1);
  assert.ok(qFromLineDrag(start, 40, 70, W) < 1);
  assert.ok(qFromLineDrag(start, 40, 10, W) > 1);
  assert.equal(qFromLineDrag(start, 40, 10_000, W), EQ_MIN_Q);
  assert.equal(qFromLineDrag(start, 40, -10_000, W), EQ_MAX_Q);
});

test('a line never swaps sides: dragged inward past its node, Q stops at the wall', () => {
  const b = band({ frequency: 1000, Q: 1 });
  const nodeX = freqToX(1000, W);
  const high = qLines(b, W, H)!.high!;
  const start = qLineReach('high', high.x, nodeX);
  let prev = b.Q;
  // Sweep the finger from the line, through the node, well past it.
  for (let x = high.x; x >= nodeX - 200; x -= 2) {
    const Q = qFromLineDrag(b, start, qLineReach('high', x, nodeX), W);
    assert.ok(Q >= prev, `Q must only rise as the high line moves in (x ${x})`);
    prev = Q;
  }
  assert.equal(prev, EQ_MAX_Q);
  assert.ok(qAtLimit(prev));
  // The mirror image holds for the low line.
  const low = qLines(b, W, H)!.low!;
  const lowStart = qLineReach('low', low.x, nodeX);
  assert.equal(qFromLineDrag(b, lowStart, qLineReach('low', nodeX + 200, nodeX), W), EQ_MAX_Q);
});

test('reach is signed by side; overlapping lines leave the side undecided', () => {
  assert.equal(qLineReach('high', 110, 100), 10);
  assert.equal(qLineReach('high', 90, 100), -10);
  assert.equal(qLineReach('low', 90, 100), 10);
  assert.ok(qLinesOverlap(qLines(band({ Q: EQ_MAX_Q }), W, H)!));
  assert.ok(!qLinesOverlap(qLines(band({ Q: 0.5 }), W, H)!));
  assert.ok(qAtLimit(EQ_MIN_Q) && qAtLimit(EQ_MAX_Q) && !qAtLimit(1));
});

test('a Q drag off max Q is neither dead nor twitchy', () => {
  const start = { frequency: 1000, Q: EQ_MAX_Q };
  const moved = qFromLineDrag(start, 0, 4, W);
  assert.ok(moved < EQ_MAX_Q);
  assert.ok(moved > EQ_MAX_Q / 2);
});

test('hit-testing: nodes beat lines, the active band wins ties, empty grabs nothing', () => {
  const nodes = [
    { id: 'a', x: 100, y: 100 },
    { id: 'b', x: 100, y: 100 },
    { id: 'c', x: 250, y: 60 },
  ];
  const lines = { low: { x: 60, y: 120 }, high: { x: 140, y: 120 } };

  assert.deepEqual(hitTestGraph(102, 101, nodes, 'b', lines), { kind: 'node', id: 'b' });
  assert.deepEqual(hitTestGraph(102, 101, nodes, 'a', lines), { kind: 'node', id: 'a' });
  assert.deepEqual(hitTestGraph(245, 62, nodes, 'a', lines), { kind: 'node', id: 'c' });

  // Far above the node, on the line.
  assert.deepEqual(hitTestGraph(143, 10, nodes, 'a', lines), { kind: 'q', side: 'high' });
  assert.deepEqual(hitTestGraph(55, 190, nodes, 'a', lines), { kind: 'q', side: 'low' });
  assert.equal(hitTestGraph(140 + Q_LINE_HIT_HALF + 1, 10, nodes, 'a', lines), null);

  // A line passing another band's node yields to the node.
  const crossing = { low: { x: 100, y: 150 }, high: { x: 400, y: 150 } };
  assert.deepEqual(hitTestGraph(100, 100 + NODE_HIT_RADIUS - 1, nodes, 'c', crossing), {
    kind: 'node',
    id: 'a',
  });

  assert.equal(hitTestGraph(320, 180, nodes, 'a', lines), null);
  assert.equal(hitTestGraph(320, 180, nodes, 'a', null), null);
});

test('scrubbing is relative, clamped, and quantized', () => {
  // Touching down never rounds an exact typed value.
  assert.equal(scrubValue('frequency', 1234.5, 0), 1234.5);
  assert.equal(scrubValue('Q', 0.707, 0), 0.707);
  assert.equal(scrubValue('gain', 0.2, 0), 0.2);

  assert.equal(scrubValue('frequency', 1000, 80), 2000);
  assert.equal(scrubValue('frequency', 1000, -80), 500);
  assert.equal(scrubValue('Q', 1, 80), 2);
  assert.equal(scrubValue('gain', 2, 20), 3);

  assert.equal(scrubValue('frequency', 1000, 10_000), 20000);
  assert.equal(scrubValue('frequency', 1000, -10_000), 20);
  assert.equal(scrubValue('Q', 1, 10_000), EQ_MAX_Q);
  assert.equal(scrubValue('gain', 0, 10_000), 12);

  assert.ok(Number.isInteger(scrubValue('frequency', 1000, 7)));
  const q = scrubValue('Q', 1, 7);
  assert.equal(Math.round(q * 100) / 100, q);
  const g = scrubValue('gain', 1, 7);
  assert.equal(Math.round(g * 10) / 10, g);
});

test('dragged gain snaps to exactly 0 dB near the line', () => {
  assert.equal(quantizeGain(0.2), 0);
  assert.equal(quantizeGain(-0.24), 0);
  assert.equal(quantizeGain(0.3), 0.3);
  assert.equal(scrubValue('gain', 1, -18), 0);
});

test('accessibility steps move by musical amounts and clamp', () => {
  assert.equal(stepValue('gain', 0, 1), 0.5);
  assert.equal(stepValue('gain', 12, 1), 12);
  assert.equal(stepValue('frequency', 1000, 1), 1122);
  assert.equal(stepValue('Q', 1, 1), 1.1);
  assert.equal(stepValue('Q', EQ_MIN_Q, -1), EQ_MIN_Q);
});

test('pass-filter nodes sit on 0 dB; range fractions span 0..1', () => {
  assert.equal(bandNodeGain({ type: 'highpass', gain: 5 }), 0);
  assert.equal(bandNodeGain({ type: 'peaking', gain: 5 }), 5);
  assert.equal(paramFraction('frequency', 20), 0);
  assert.equal(paramFraction('frequency', 20000), 1);
  assert.equal(paramFraction('gain', 0), 0.5);
  assert.equal(paramFraction('Q', EQ_MAX_Q), 1);
});
