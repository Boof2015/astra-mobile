// Regenerate parity cases from the desktop tests, never from the mobile port.
// Usage: node scripts/generate-resolve-fixtures.mjs [desktop checkout]
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const desktop = resolve(process.argv[2] ?? '../astra');
const revision = execFileSync('git', ['-C', desktop, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const temp = mkdtempSync(join(tmpdir(), 'astra-resolve-reference-'));
const source = (name) => pathToFileURL(join(desktop, 'src/shared/library', `${name}.ts`)).href;
try {
  writeFileSync(join(temp, 'artists.mjs'), `
    import * as real from ${JSON.stringify(source('artistCredits'))};
    export * from ${JSON.stringify(source('artistCredits'))};
    const libraries = new WeakMap();
    export function buildArtistIdentityIndex(tracks) {
      const index = real.buildArtistIdentityIndex(tracks);
      libraries.set(index, tracks);
      globalThis.artistCases.push({ tracks, expected: tracks.map(track => ({
        artists: real.resolveTrackArtistNames(track, index),
        albumArtists: real.resolveTrackArtistNames(track, index, true)
      })) });
      return index;
    }
    export function resolveArtistCredit(raw, index, context) {
      const expected = real.resolveArtistCredit(raw, index, context);
      globalThis.creditCases.push({ tracks: libraries.get(index) ?? [], raw, album: context?.album, expected });
      return expected;
    }
  `);
  writeFileSync(join(temp, 'albums.mjs'), `
    import * as real from ${JSON.stringify(source('albumGrouping'))};
    export * from ${JSON.stringify(source('albumGrouping'))};
    const captured = new Map();
    export function groupTracksByAlbumIdentity(tracks, id, index) {
      const groups = real.groupTracksByAlbumIdentity(tracks, id, index);
      const ordered = tracks.map(t => ({ ...t, id: id(t) })).sort((a, b) => a.id.localeCompare(b.id));
      const expected = [...groups.values()].map(g => ({
        identityKey: g.identityKey, albumKey: g.albumKey, mode: g.groupingMode,
        displayArtist: g.displayArtist, ids: g.tracks.map(id).sort()
      })).sort((a,b) => a.identityKey.localeCompare(b.identityKey));
      const signature = JSON.stringify(ordered);
      let fixture = captured.get(signature);
      if (!fixture) {
        fixture = { tracks: ordered, expected, orders: [] };
        captured.set(signature, fixture);
        globalThis.albumCases.push(fixture);
      } else if (JSON.stringify(fixture.expected) !== JSON.stringify(expected)) {
        throw new Error('Desktop produced order-dependent album identities');
      }
      const positions = new Map(ordered.map((track, position) => [track.id, position]));
      const order = tracks.map(track => positions.get(id(track)));
      if (!fixture.orders.some(previous => JSON.stringify(previous) === JSON.stringify(order))) fixture.orders.push(order);
      return groups;
    }
  `);
  for (const [name, wrapper] of [['artistCredits', 'artists'], ['albumGrouping', 'albums'], ['albumGrouping.regression', 'albums']]) {
    const moduleName = name.split('.')[0];
    const test = readFileSync(join(desktop, 'src/shared/library', `${name}.test.ts`), 'utf8')
      .replaceAll(`'./${moduleName}.ts'`, `'./${wrapper}.mjs'`)
      .replaceAll(/'\.\/__fixtures__\/([^']+)'/g, (_, file) =>
        JSON.stringify(pathToFileURL(join(desktop, 'src/shared/library/__fixtures__', file)).href));
    writeFileSync(join(temp, `${name}.test.mts`), test);
  }
  writeFileSync(join(temp, 'capture.mjs'), `
    import { writeFileSync } from 'node:fs';
    globalThis.artistCases = []; globalThis.creditCases = []; globalThis.albumCases = [];
    await import('./artistCredits.test.mts');
    await import('./albumGrouping.test.mts');
    await import('./albumGrouping.regression.test.mts');
    const { groupTracksByAlbumIdentity } = await import('./albums.mjs');
    groupTracksByAlbumIdentity([
      { id: 'Z', artist: 'Artist', album: 'Overlapping releases', year: 2002 },
      { id: 'a', artist: 'Artist', album: 'Overlapping releases', year: 2000 },
      { id: 'b', artist: 'Artist', album: 'Overlapping releases', year: 2001 }
    ], track => track.id);
    process.on('exit', () => writeFileSync(${JSON.stringify(join(temp, 'cases.json'))}, JSON.stringify({
      revision: ${JSON.stringify(revision)}, artists: globalThis.artistCases,
      credits: globalThis.creditCases, albums: globalThis.albumCases
    }, null, 2)));
  `);
  execFileSync(process.execPath, ['--experimental-strip-types', join(temp, 'capture.mjs')], { stdio: 'pipe' });
  const output = resolve('test/fixtures/resolve/desktop.json');
  mkdirSync(resolve('test/fixtures/resolve'), { recursive: true });
  // Keep each permutation on one line; metadata is stored once per distinct case.
  const captured = readFileSync(join(temp, 'cases.json'), 'utf8')
    .replace(/\[\n\s+\d+(?:,\n\s+\d+)*\n\s*\]/g, (order) => order.replace(/\s+/g, ' ').replace('[ ', '[').replace(' ]', ']'));
  writeFileSync(output, captured + '\n');
  console.log(`Captured desktop ${revision} Resolve fixtures in ${output}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
