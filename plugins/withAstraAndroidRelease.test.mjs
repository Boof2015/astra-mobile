import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { _internal } = require('./withAstraAndroidRelease.js');

const APP_GRADLE = `apply plugin: "com.android.application"

android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`;

test('adds fail-closed release signing without changing debug signing', () => {
  const transformed = _internal.addReleaseSigning(APP_GRADLE);

  assert.match(transformed, /ASTRA_ALLOW_INSECURE_RELEASE_SIGNING/);
  assert.match(transformed, /throw new GradleException\('Release signing is not configured/);
  assert.match(transformed, /debug \{\n            signingConfig signingConfigs\.debug/);
  assert.match(
    transformed,
    /release \{\n            signingConfig astraReleaseSigningConfigured \? signingConfigs\.release : signingConfigs\.debug/
  );
});

test('release signing transform is idempotent', () => {
  const transformed = _internal.addReleaseSigning(APP_GRADLE);
  assert.equal(_internal.addReleaseSigning(transformed), transformed);
  assert.equal(transformed.split(_internal.SIGNING_MARKER).length - 1, 1);
});

test('adds an idempotent side-by-side Astra Dev preview build', () => {
  const transformed = _internal.addPreviewBuildType(APP_GRADLE);

  assert.match(transformed, /ASTRA SIDE-BY-SIDE PREVIEW/);
  assert.match(transformed, /preview \{\n            initWith release/);
  assert.match(transformed, /applicationIdSuffix '\.dev'/);
  assert.match(transformed, /signingConfig signingConfigs\.debug/);
  assert.match(transformed, /resValue 'string', 'app_name', 'Astra Dev'/);
  assert.equal(_internal.addPreviewBuildType(transformed), transformed);
});

test('appendBlock adds a native block exactly once', () => {
  const once = _internal.appendBlock('base\n', _internal.SETTINGS_MARKER, `\n${_internal.SETTINGS_MARKER}\nblock\n`);
  const twice = _internal.appendBlock(once, _internal.SETTINGS_MARKER, `\n${_internal.SETTINGS_MARKER}\nblock\n`);

  assert.equal(once, twice);
  assert.equal(once.split(_internal.SETTINGS_MARKER).length - 1, 1);
});

test('raises the generated Gradle Metaspace cap while preserving unrelated properties', () => {
  const properties = [
    { type: 'comment', value: 'Project-wide Gradle settings.' },
    {
      type: 'property',
      key: _internal.GRADLE_JVM_ARGS_PROPERTY,
      value: '-Xmx2048m -XX:MaxMetaspaceSize=512m',
    },
    { type: 'property', key: 'org.gradle.parallel', value: 'true' },
  ];

  assert.deepEqual(
    _internal.upsertGradleProperty(
      properties,
      _internal.GRADLE_JVM_ARGS_PROPERTY,
      _internal.GRADLE_JVM_ARGS_VALUE
    ),
    [
      properties[0],
      {
        type: 'property',
        key: _internal.GRADLE_JVM_ARGS_PROPERTY,
        value: '-Xmx2048m -XX:MaxMetaspaceSize=1024m',
      },
      properties[2],
    ]
  );
});

test('adds the Gradle JVM arguments when the generated property is absent', () => {
  const transformed = _internal.upsertGradleProperty(
    [{ type: 'property', key: 'org.gradle.parallel', value: 'true' }],
    _internal.GRADLE_JVM_ARGS_PROPERTY,
    _internal.GRADLE_JVM_ARGS_VALUE
  );

  assert.deepEqual(transformed.slice(-2), [
    { type: 'empty' },
    {
      type: 'property',
      key: _internal.GRADLE_JVM_ARGS_PROPERTY,
      value: _internal.GRADLE_JVM_ARGS_VALUE,
    },
  ]);
});

test('Gradle JVM argument transform is idempotent and removes duplicate properties', () => {
  const properties = [
    {
      type: 'property',
      key: _internal.GRADLE_JVM_ARGS_PROPERTY,
      value: '-Xmx2048m -XX:MaxMetaspaceSize=512m',
    },
    {
      type: 'property',
      key: _internal.GRADLE_JVM_ARGS_PROPERTY,
      value: '-Xmx1024m -XX:MaxMetaspaceSize=256m',
    },
  ];
  const once = _internal.upsertGradleProperty(
    properties,
    _internal.GRADLE_JVM_ARGS_PROPERTY,
    _internal.GRADLE_JVM_ARGS_VALUE
  );
  const twice = _internal.upsertGradleProperty(
    once,
    _internal.GRADLE_JVM_ARGS_PROPERTY,
    _internal.GRADLE_JVM_ARGS_VALUE
  );

  assert.deepEqual(twice, once);
  assert.equal(
    once.filter(
      (property) =>
        property.type === 'property' && property.key === _internal.GRADLE_JVM_ARGS_PROPERTY
    ).length,
    1
  );
});

test('marks QR scanning camera hardware as optional without duplicating it', () => {
  const manifest = { manifest: {} };

  _internal.ensureOptionalCameraFeature(manifest);
  _internal.ensureOptionalCameraFeature(manifest);

  assert.deepEqual(manifest.manifest['uses-feature'], [
    {
      $: {
        'android:name': 'android.hardware.camera',
        'android:required': 'false',
      },
    },
  ]);
});

test('writes deterministic Astra and RNTP notification icon resources', async (t) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'astra-notification-icon-'));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));

  await _internal.writeNotificationIconResources(projectRoot);
  const drawablePath = path.join(
    projectRoot,
    'app/src/main/res/drawable',
    _internal.NOTIFICATION_ICON_FILE
  );
  const overridePath = path.join(
    projectRoot,
    'app/src/main/res/values',
    _internal.NOTIFICATION_OVERRIDE_FILE
  );
  const firstDrawable = await readFile(drawablePath, 'utf8');
  const firstOverride = await readFile(overridePath, 'utf8');

  assert.equal(firstDrawable, _internal.NOTIFICATION_ICON_VECTOR);
  assert.match(firstDrawable, /android:width="24dp"/);
  assert.match(firstDrawable, /android:fillColor="#FFFFFFFF"/);
  assert.doesNotMatch(firstDrawable, /background|logoShadow/);
  assert.equal(firstOverride, _internal.NOTIFICATION_ICON_OVERRIDE);
  assert.match(
    firstOverride,
    /name="exo_notification_small_icon" type="drawable">@drawable\/astra_notification_icon/
  );

  await _internal.writeNotificationIconResources(projectRoot);
  assert.equal(await readFile(drawablePath, 'utf8'), firstDrawable);
  assert.equal(await readFile(overridePath, 'utf8'), firstOverride);
});
