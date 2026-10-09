import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { configureTvManifest, writeTvResources } = require('./withAstraTv.js')._internal;

test('TV launcher survives prebuild without replacing mobile icons or excluding phones', () => {
  const manifest = { manifest: { application: [{
    $: { 'android:name': '.MainApplication', 'android:icon': '@mipmap/ic_launcher', 'android:roundIcon': '@mipmap/ic_launcher_round' },
    activity: [{ $: { 'android:name': '.MainActivity' }, 'intent-filter': [{
      action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
      category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
    }] }],
  }] } };
  configureTvManifest(manifest);
  const once = structuredClone(manifest);
  configureTvManifest(manifest);
  assert.deepEqual(manifest, once);
  const application = manifest.manifest.application[0];
  assert.equal(application.$['android:icon'], '@mipmap/ic_launcher');
  assert.equal(application.$['android:roundIcon'], '@mipmap/ic_launcher_round');
  assert.equal(application.$['android:banner'], '@drawable/astra_tv_banner');
  assert.deepEqual(application.activity[0]['intent-filter'][0].category.map(item => item.$['android:name']), [
    'android.intent.category.LAUNCHER', 'android.intent.category.LEANBACK_LAUNCHER',
  ]);
  assert.ok(manifest.manifest['uses-feature'].every(item => item.$['android:required'] === 'false'));
});

test('generated TV branding leaves existing phone resources untouched across regeneration', async () => {
  const androidRoot = await mkdtemp(path.join(tmpdir(), 'astra-tv-branding-'));
  try {
    const resources = path.join(androidRoot, 'app/src/main/res');
    const phone = path.join(resources, 'mipmap-anydpi-v26/ic_launcher.xml');
    await mkdir(path.dirname(phone), { recursive: true });
    await writeFile(phone, 'existing phone icon');
    const projectRoot = path.resolve(import.meta.dirname, '..');
    await writeTvResources(projectRoot, androidRoot);
    const banner = await readFile(path.join(resources, 'drawable/astra_tv_banner.xml'), 'utf8');
    await writeTvResources(projectRoot, androidRoot);
    assert.equal(await readFile(phone, 'utf8'), 'existing phone icon');
    assert.equal(await readFile(path.join(resources, 'drawable/astra_tv_banner.xml'), 'utf8'), banner);
    for (const version of ['', '-v26']) for (const name of ['ic_launcher', 'ic_launcher_round']) {
      assert.ok((await readFile(path.join(resources, `mipmap-television-anydpi${version}/${name}.xml`), 'utf8')).includes(version ? '<adaptive-icon' : '<vector'));
    }
  } finally {
    await rm(androidRoot, { recursive: true, force: true });
  }
});
