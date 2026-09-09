import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { hasAtmosMetadata } from './atmos.ts';
import * as artistCredits from './artistCreditTransport.ts';

test('only explicit Atmos metadata qualifies', () => {
  for (const track of [
    { isAtmosJoc: true },
    { codec: 'audio/eac3-joc' },
    { codec: 'E-AC-3', codecProfile: 'Dolby Atmos' },
    { codec: 'ec-3', codecProfile: 'JOC' },
  ]) assert.equal(hasAtmosMetadata(track), true);
  for (const track of [
    {}, { codec: null }, { isAtmosJoc: false },
    ...['ec3', 'ec-3', 'eac3', 'audio/eac3', 'E-AC-3', 'DD+', 'ac3', 'flac', 'aac'].map(codec => ({ codec })),
    { codec: 'eac3', title: 'Atmos mix', channels: 6 },
  ]) assert.equal(hasAtmosMetadata(track), false);
});

// Run the production adapters; stub only their unrelated artwork/URL services.
function loadAdapter(path: string) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: any = {};
  const imports = (name: string) => {
    if (name.endsWith('/artwork')) return {
      artworkUri: () => undefined,
      artworkThumbFromSource: () => undefined,
      playerBackdropArtworkSource: () => undefined,
    };
    if (name.endsWith('/remoteUrls')) return {
      artworkUrlForTrack: () => undefined,
      streamUrlForTrack: () => 'https://example.test/music',
    };
    if (name === './artistCreditTransport') return artistCredits;
    throw new Error(`Unexpected dependency: ${name}`);
  };
  new Function('require', 'exports', source)(imports, exports);
  return exports;
}

test('catalog Atmos metadata survives the native player round trip for local and remote tracks', () => {
  const { dbTrackToTrack } = loadAdapter('../library/trackAdapter.ts');
  const { toRntpTrack, rntpToTrack } = loadAdapter('./sampleTracks.ts');
  for (const source_type of ['local', 'jellyfin']) {
    for (const metadata of [
      { codec: 'eac3', codec_profile: 'JOC', is_atmos_joc: 1 },
      { codec: 'eac3', codec_profile: null, is_atmos_joc: null },
      { codec: 'aac', codec_profile: null, is_atmos_joc: 0 },
      { codec: null }, // Legacy catalog rows.
    ]) {
      const catalog = {
        id: 42, path: 'content://music/song', title: 'Song', artist: 'Artist',
        album: 'Album', duration: 180, format: 'M4A', source_type, ...metadata,
      };
      const track = dbTrackToTrack(catalog);
      // Android's originalItem bundle is returned as JSON-compatible values.
      const native = JSON.parse(JSON.stringify(toRntpTrack(track)));
      const restored = rntpToTrack(native);
      assert.equal(restored.path, track.path);
      assert.equal(restored.codec, track.codec);
      assert.equal(restored.codecProfile, track.codecProfile);
      assert.equal(restored.isAtmosJoc, track.isAtmosJoc);
      assert.equal(hasAtmosMetadata(restored), metadata.is_atmos_joc === 1);
    }
  }
});
