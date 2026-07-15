import assert from 'node:assert/strict';
import test from 'node:test';
import { matchSignalToLibrary, type SignalMatchableTrack } from './signalLocalMatch.ts';

interface TestTrack extends SignalMatchableTrack {
  album: string;
}

function track(overrides: Partial<TestTrack> = {}): TestTrack {
  return {
    path: '/music/replay.flac',
    title: 'Replay',
    artist: 'ナナツカゼ',
    album: 'Signal Tests',
    duration: 213.6,
    ...overrides,
  };
}

test('matches Unicode and punctuation without losing identity', () => {
  const candidate = track({ artist: 'N!GHT', title: '#iwannadance', duration: 222.3 });
  const result = matchSignalToLibrary(
    { artist: 'N!GHT', title: '#iwannadance', durationSec: 222 },
    [candidate]
  );
  assert.equal(result.kind, 'match');
  if (result.kind !== 'match') return;
  assert.equal(result.candidate.track, candidate);
  assert.equal(result.candidate.match, 'exact');
});

test('uses duration to reject a different version of an exact metadata match', () => {
  const result = matchSignalToLibrary(
    { artist: 'ナナツカゼ', title: 'Replay', durationSec: 214 },
    [track(), track({ path: '/music/replay-live.flac', duration: 278 })]
  );
  assert.equal(result.kind, 'match');
  if (result.kind !== 'match') return;
  assert.equal(result.candidate.track.path, '/music/replay.flac');
});

test('returns ambiguity instead of guessing between equivalent local versions', () => {
  const result = matchSignalToLibrary(
    { artist: 'ナナツカゼ', title: 'Replay', durationSec: 214 },
    [
      track({ path: '/music/replay-flac.flac', album: 'Replay', duration: 213.6 }),
      track({ path: '/music/replay-mp3.mp3', album: 'Singles', duration: 214.1 }),
    ]
  );
  assert.equal(result.kind, 'ambiguous');
  if (result.kind !== 'ambiguous') return;
  assert.deepEqual(result.candidates.map((entry) => entry.track.path), [
    '/music/replay-mp3.mp3',
    '/music/replay-flac.flac',
  ]);
});

test('allows a duration-gated punctuation and diacritic fallback', () => {
  const candidate = track({ artist: 'Beyoncé', title: 'Déjà Vu', duration: 223.4 });
  const result = matchSignalToLibrary(
    { artist: 'Beyonce', title: 'Deja Vu', durationSec: 223 },
    [candidate]
  );
  assert.equal(result.kind, 'match');
  if (result.kind !== 'match') return;
  assert.equal(result.candidate.match, 'normalized');
});

test('prefers punctuation-preserving candidates over a closer relaxed candidate', () => {
  const exact = track({ path: '/music/night.flac', artist: 'N!GHT', title: 'Replay', duration: 221.8 });
  const relaxed = track({ path: '/music/n-ght.flac', artist: 'N GHT', title: 'Replay', duration: 220 });
  const result = matchSignalToLibrary(
    { artist: 'N!GHT', title: 'Replay', durationSec: 220 },
    [relaxed, exact]
  );
  assert.equal(result.kind, 'match');
  if (result.kind !== 'match') return;
  assert.equal(result.candidate.track, exact);
});

test('does not relax empty or duration-free metadata into a plausible match', () => {
  assert.deepEqual(
    matchSignalToLibrary({ artist: '', title: 'Replay', durationSec: 214 }, [track()]),
    { kind: 'none' }
  );
  assert.deepEqual(
    matchSignalToLibrary(
      { artist: 'N GHT', title: 'Replay', durationSec: 0 },
      [track({ artist: 'N!GHT' })]
    ),
    { kind: 'none' }
  );
});

test('does not ignore a Signal duration when the library duration is unavailable', () => {
  assert.deepEqual(
    matchSignalToLibrary(
      { artist: 'ナナツカゼ', title: 'Replay', durationSec: 214 },
      [track({ duration: 0 })]
    ),
    { kind: 'none' }
  );
});
