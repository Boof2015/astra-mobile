import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseHomeGreeting,
  getDayAwareGreetings,
  getHomeGreetingBucket,
  getTimeAwareGreetings,
  HOME_PLAYFUL_GREETINGS,
  parseHomeGreetingTextMode,
} from './homeGreeting.ts';

function localDate(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

test('defaults missing and invalid greeting modes to messages', () => {
  assert.equal(parseHomeGreetingTextMode(null), 'messages');
  assert.equal(parseHomeGreetingTextMode(''), 'messages');
  assert.equal(parseHomeGreetingTextMode('weather'), 'messages');
  assert.equal(parseHomeGreetingTextMode('messages'), 'messages');
  assert.equal(parseHomeGreetingTextMode('clock'), 'clock');
  assert.equal(parseHomeGreetingTextMode('off'), 'off');
});

test('uses exact time-window boundaries', () => {
  const starts: Array<[number, string]> = [
    [0, 'time-midnight'],
    [180, 'time-three-am'],
    [300, 'time-early-morning'],
    [420, 'time-morning'],
    [660, 'time-late-morning'],
    [720, 'time-early-afternoon'],
    [840, 'time-afternoon'],
    [1020, 'time-sunset'],
    [1080, 'time-evening'],
    [1380, 'time-late-night'],
  ];

  for (const [minute, id] of starts) {
    const hour = Math.floor(minute / 60);
    const minuteOfHour = minute % 60;
    assert.equal(getTimeAwareGreetings(localDate(2026, 7, 14, hour, minuteOfHour))[0].id, id);
  }
});

test('keeps the approved mobile playful copy intact', () => {
  assert.equal(HOME_PLAYFUL_GREETINGS.length, 15);
  assert.deepEqual(HOME_PLAYFUL_GREETINGS.at(-2), {
    id: 'playful-pocket',
    primary: 'I fit in your pocket now.',
    subline: 'This was a mistake.',
  });
  assert.deepEqual(HOME_PLAYFUL_GREETINGS.at(-1), {
    id: 'playful-rectangle',
    primary: 'This rectangle demands music.',
    subline: 'Obey.',
  });
  assert.equal(
    HOME_PLAYFUL_GREETINGS.some((message) => message.primary === 'Pocket concert.'),
    false
  );
});

test('only supplies day-aware greetings on the selected weekdays', () => {
  assert.equal(getDayAwareGreetings(localDate(2026, 7, 13, 12))[0].id, 'day-monday');
  assert.equal(getDayAwareGreetings(localDate(2026, 7, 14, 12)).length, 0);
  assert.equal(getDayAwareGreetings(localDate(2026, 7, 15, 12))[0].id, 'day-wednesday');
  assert.equal(getDayAwareGreetings(localDate(2026, 7, 17, 12))[0].id, 'day-friday');
  assert.equal(getDayAwareGreetings(localDate(2026, 7, 19, 12))[0].id, 'day-sunday');
});

test('maps local time to the four adaptive tint buckets', () => {
  assert.equal(getHomeGreetingBucket(localDate(2026, 7, 14, 4, 59)), 'late-night');
  assert.equal(getHomeGreetingBucket(localDate(2026, 7, 14, 5, 0)), 'morning');
  assert.equal(getHomeGreetingBucket(localDate(2026, 7, 14, 12, 0)), 'afternoon');
  assert.equal(getHomeGreetingBucket(localDate(2026, 7, 14, 18, 0)), 'evening');
  assert.equal(getHomeGreetingBucket(localDate(2026, 7, 14, 23, 0)), 'late-night');
});

test('uses deterministic weighted selection for time, day, and playful pools', () => {
  const mondayNoon = localDate(2026, 7, 13, 12);
  assert.equal(chooseHomeGreeting(null, mondayNoon, () => 0).id, 'time-early-afternoon');
  assert.equal(chooseHomeGreeting(null, mondayNoon, () => 0.5).id, 'day-monday');

  const values = [0.99, 0.999];
  assert.equal(
    chooseHomeGreeting(null, mondayNoon, () => values.shift() ?? 0).id,
    'playful-rectangle'
  );
});

test('avoids immediately repeating the previous message', () => {
  const mondayNoon = localDate(2026, 7, 13, 12);
  const values = [0, 0, 0];
  const next = chooseHomeGreeting(
    'time-early-afternoon',
    mondayNoon,
    () => values.shift() ?? 0
  );
  assert.notEqual(next.id, 'time-early-afternoon');
});
