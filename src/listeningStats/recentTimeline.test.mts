import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPlayDay, localDayStart, nextLocalDay, timelineRows } from './recentTimeline.ts';

function play(id: string, path: string, playedAt: number, kind: 'session' | 'summary' = 'session') {
  return { kind, id, path, playedAt, track: null, title: path, artist: 'Artist' };
}

test('a page seam extends only the adjacent run, preserving its latest occurrence for replay', () => {
  const today = localDayStart(Date.now());
  const firstPage = [play('5', 'A', today + 5), play('4', 'B', today + 4)];
  const nextPage = [play('3', 'B', today + 3), play('2', 'A', today + 2), play('1', 'A', today - 1)];
  const head = timelineRows(firstPage, today);
  const rows = timelineRows(nextPage, today, head);
  assert.deepEqual(rows, timelineRows([...firstPage, ...nextPage], today));
  assert.equal(head[2].kind === 'play' && head[2].count, 1);
  assert.equal(rows[1], head[1]);
  assert.deepEqual(rows.map(row => row.kind === 'heading' ? row.title : [row.entry.id, row.count]),
    ['Today', ['5', 1], ['4', 2], ['2', 1], 'Yesterday', ['1', 1]]);
  assert.equal(rows[2].key, head[2].key);
});

test('last known plays have their own date headings and never inflate a repeat count', () => {
  const today = localDayStart(Date.now());
  const rows = timelineRows([play('A', 'A', today), play('A', 'A', today, 'summary')], today);
  assert.deepEqual(rows.map(row => row.kind === 'heading' ? row.title : row.key),
    ['Today', 'session:A', 'Last known plays', 'Today', 'summary:A']);
});

test('day labels and replay bounds follow local midnight through a clock change', () => {
  const original = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const midnight = new Date(2026, 10, 1).getTime();
    const next = nextLocalDay(midnight);
    assert.equal(next - midnight, 25 * 60 * 60 * 1000);
    assert.equal(localDayStart(next - 1), midnight);
    assert.equal(formatPlayDay(midnight, next), 'Yesterday');
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
