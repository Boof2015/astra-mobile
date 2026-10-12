import test from 'node:test';
import assert from 'node:assert/strict';
import { ambientText, parseAmbientDelay, type AmbientMoment } from './ambientModel.ts';

const now = new Date(2026, 9, 10, 12).getTime();
const day = 86_400_000;
const base: AmbientMoment = {
  album: { identity_key: 'album', album: 'An album', artist: 'An artist', year: null,
    artwork_hash: null, track_count: 9, latest_added_at: now - 90 * day },
  reason: 'collection', relatedArtist: 'An artist', favoriteTracks: 0,
  historyEnabled: true, plays: 38, weekPlays: 0,
  firstPlayedAt: now - 180 * day, lastPlayedAt: now - 90 * day, reset: false,
};

test('missing or invalid Ambient preferences use the two-minute default; Off survives reload', () => {
  for (const value of [null, '', 'bad', '-1', '60']) assert.equal(parseAmbientDelay(value), 2);
  for (const value of ['0', '1', '2', '5']) assert.equal(parseAmbientDelay(value), Number(value));
});

test('turning history off suppresses cached facts and history-derived reasons immediately', () => {
  for (const reason of ['forgotten', 'repeat'] as const) {
    assert.deepEqual(ambientText({ ...base, reason, weekPlays: 12 }, false, now), {
      label: 'From your collection', context: 'Album · 9 tracks',
    });
    assert.deepEqual(ambientText({ ...base, reason, historyEnabled: false }, true, now), {
      label: 'From your collection', context: 'Album · 9 tracks',
    });
  }
});

test('fresh history uses library facts without claiming a listening memory', () => {
  assert.equal(ambientText({ ...base, plays: 0, weekPlays: 0, firstPlayedAt: null, lastPlayedAt: null }, true, now).context, 'Album · 9 tracks');
  assert.deepEqual(ambientText({ ...base, reason: 'related', plays: 0 }, true, now), {
    label: 'More from An artist', context: 'Album · 9 tracks',
  });
  assert.equal(ambientText({ ...base, reason: 'favorite', favoriteTracks: 4 }, false, now).context, 'Album · 9 tracks');
});

test('history facts belong to the shown album and use a single quiet line', () => {
  assert.match(ambientText({ ...base, reason: 'forgotten' }, true, now).context, /^Last played in .+ · 38 plays$/);
  assert.equal(ambientText({ ...base, reason: 'repeat', weekPlays: 12, lastPlayedAt: now }, true, now).context, '12 plays this week');
  assert.equal(ambientText({ ...base, reason: 'favorite', favoriteTracks: 4 }, true, now).context, 'In your Favorites · 4 favorited tracks');
  assert.match(ambientText({ ...base, lastPlayedAt: now }, true, now).context, /^First recorded .+ · 38 plays$/);
});

test('recent additions retain non-history context and single tracks read naturally', () => {
  const album = { ...base.album, latest_added_at: now - 3 * day, track_count: 1 };
  assert.equal(ambientText({ ...base, album, reason: 'added' }, false, now).context, 'Added 3 days ago');
  assert.equal(ambientText({ ...base, album }, false, now).context, 'Single · 1 track');
  assert.equal(ambientText({ ...base, album: { ...album, latest_added_at: now + day }, reason: 'added' }, false, now).context, 'Added today');
});
