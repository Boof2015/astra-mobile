import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildArtistIdentityIndex, resolveTrackArtistNames, resolveArtistCredit } from './artistCredits.ts';
import { groupTracksByAlbumIdentity } from './albumGrouping.ts';

const corpus = JSON.parse(readFileSync(new URL('../../../test/fixtures/resolve/desktop.json', import.meta.url), 'utf8'));

test(`artist resolution matches captured desktop ${corpus.revision}`, () => {
  for (const fixture of corpus.artists) {
    const index = buildArtistIdentityIndex(fixture.tracks);
    assert.deepEqual(fixture.tracks.map((track: any) => ({
      artists: resolveTrackArtistNames(track, index),
      albumArtists: resolveTrackArtistNames(track, index, true),
    })), fixture.expected);
  }
  for (const fixture of corpus.credits) {
    assert.deepEqual(resolveArtistCredit(fixture.raw, buildArtistIdentityIndex(fixture.tracks), { album: fixture.album }), fixture.expected);
  }
});

test(`album identities match captured desktop ${corpus.revision}`, () => {
  for (const fixture of corpus.albums) {
    const groups = groupTracksByAlbumIdentity(fixture.tracks, (track: any) => track.id);
    assert.deepEqual([...groups.values()].map((group) => ({
      identityKey: group.identityKey, albumKey: group.albumKey, mode: group.groupingMode,
      displayArtist: group.displayArtist, ids: group.tracks.map((track: any) => track.id).sort(),
    })).sort((a, b) => a.identityKey.localeCompare(b.identityKey)), fixture.expected);
  }
});
