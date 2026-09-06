// Capture core expectations from desktop's installed music-metadata parser.
// Usage: node scripts/capture-metadata-reference.mjs [desktop checkout]
import { createRequire } from 'node:module';
import { readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const desktop = resolve(process.argv[2] ?? '../astra');
const require = createRequire(resolve(desktop, 'package.json'));
const mm = await import(pathToFileURL(require.resolve('music-metadata')).href);
const revision = execFileSync('git', ['-C', desktop, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const root = resolve('test/fixtures/metadata');
const rows = [];
for (const file of (await readdir(root)).filter(name => name.startsWith('tags')).sort()) {
  const { common, format } = await mm.parseFile(resolve(root, file), { duration: true });
  const picture = mm.selectCover(common.picture);
  rows.push({
    file, title: common.title ?? null, artist: common.artist ?? null,
    artists: common.artists ?? [], album: common.album ?? null,
    albumArtist: common.albumartist ?? null,
    albumArtists: common.albumartists ?? (common.albumartist ? [common.albumartist] : []),
    genre: common.genre?.join('; ') ?? null, year: common.year ?? null,
    trackNumber: common.track.no, trackTotal: common.track.of,
    discNumber: common.disk.no, discTotal: common.disk.of,
    pictureMd5: picture ? createHash('md5').update(picture.data).digest('hex') : null,
    duration: format.duration ?? null,
  });
}
await writeFile(resolve(root, 'desktop.json'), `${JSON.stringify(rows, null, 2)}\n`);
console.log(`Captured ${rows.length} metadata fixtures using desktop ${revision}`);
