import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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

test('appendBlock adds a native block exactly once', () => {
  const once = _internal.appendBlock('base\n', _internal.SETTINGS_MARKER, `\n${_internal.SETTINGS_MARKER}\nblock\n`);
  const twice = _internal.appendBlock(once, _internal.SETTINGS_MARKER, `\n${_internal.SETTINGS_MARKER}\nblock\n`);

  assert.equal(once, twice);
  assert.equal(once.split(_internal.SETTINGS_MARKER).length - 1, 1);
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
