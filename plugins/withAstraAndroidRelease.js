const {
  AndroidConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withProjectBuildGradle,
  withSettingsGradle,
} = require('expo/config-plugins');

const SETTINGS_MARKER = '// ASTRA VENDORED KOTLIN AUDIO';
const PROJECT_BUILD_MARKER = '// ASTRA KOTLIN AUDIO SUBSTITUTION';
const SIGNING_MARKER = '// ASTRA RELEASE SIGNING';
const CAMERA_FEATURE = 'android.hardware.camera';

const SETTINGS_BLOCK = `

${SETTINGS_MARKER}
include ':kotlin-audio'
project(':kotlin-audio').projectDir = new File(rootDir, '../vendor/kotlinaudio/kotlin-audio')
`;

const PROJECT_BUILD_BLOCK = `

${PROJECT_BUILD_MARKER}
subprojects {
  configurations.configureEach {
    resolutionStrategy.dependencySubstitution {
      substitute module('com.github.doublesymmetry:kotlinaudio') using project(':kotlin-audio')
    }
  }
}
`;

const SIGNING_CONFIGURATION = `${SIGNING_MARKER}
def astraReleaseStorePath = System.getenv('ASTRA_ANDROID_KEYSTORE_PATH')
def astraReleaseStorePassword = System.getenv('ASTRA_ANDROID_KEYSTORE_PASSWORD')
def astraReleaseKeyAlias = System.getenv('ASTRA_ANDROID_KEY_ALIAS')
def astraReleaseKeyPassword = System.getenv('ASTRA_ANDROID_KEY_PASSWORD')
def astraAllowInsecureReleaseSigning = (System.getenv('ASTRA_ALLOW_INSECURE_RELEASE_SIGNING') ?: 'false').toBoolean()
def astraReleaseSigningValues = [
    astraReleaseStorePath,
    astraReleaseStorePassword,
    astraReleaseKeyAlias,
    astraReleaseKeyPassword,
]
def astraReleaseSigningConfigured = astraReleaseSigningValues.every { value -> value != null && !value.trim().isEmpty() }

gradle.taskGraph.whenReady { taskGraph ->
    def astraReleaseTaskRequested = taskGraph.allTasks.any { task -> task.name.toLowerCase().contains('release') }
    if (astraReleaseTaskRequested && !astraReleaseSigningConfigured && !astraAllowInsecureReleaseSigning) {
        throw new GradleException('Release signing is not configured. Supply the ASTRA_ANDROID_KEYSTORE_* variables, or explicitly set ASTRA_ALLOW_INSECURE_RELEASE_SIGNING=true for a non-publishable local preview.')
    }
}

if (astraReleaseSigningConfigured && !file(astraReleaseStorePath).isFile()) {
    throw new GradleException('ASTRA_ANDROID_KEYSTORE_PATH does not point to a file: ' + astraReleaseStorePath)
}
`;

const RELEASE_SIGNING_CONFIG = `        if (astraReleaseSigningConfigured) {
            release {
                storeFile file(astraReleaseStorePath)
                storePassword astraReleaseStorePassword
                keyAlias astraReleaseKeyAlias
                keyPassword astraReleaseKeyPassword
            }
        }
`;

function appendBlock(contents, marker, block) {
  return contents.includes(marker) ? contents : `${contents.trimEnd()}${block}`;
}

function addReleaseSigning(contents) {
  if (contents.includes(SIGNING_MARKER)) return contents;

  const androidAnchor = 'android {';
  const signingAnchor = '    signingConfigs {\n        debug {';
  const debugSigning = 'signingConfig signingConfigs.debug';

  if (!contents.includes(androidAnchor)) {
    throw new Error('Unable to add Astra release signing: android block was not found.');
  }
  if (!contents.includes(signingAnchor)) {
    throw new Error('Unable to add Astra release signing: signingConfigs debug block was not found.');
  }

  let result = contents.replace(androidAnchor, `${SIGNING_CONFIGURATION}\n${androidAnchor}`);
  result = result.replace(
    signingAnchor,
    `    signingConfigs {\n${RELEASE_SIGNING_CONFIG}        debug {`
  );

  const lastDebugSigning = result.lastIndexOf(debugSigning);
  if (lastDebugSigning < 0) {
    throw new Error('Unable to add Astra release signing: release signing assignment was not found.');
  }

  return `${result.slice(0, lastDebugSigning)}signingConfig astraReleaseSigningConfigured ? signingConfigs.release : signingConfigs.debug${result.slice(lastDebugSigning + debugSigning.length)}`;
}

function withVendoredKotlinAudio(config) {
  config = withSettingsGradle(config, (mod) => {
    mod.modResults.contents = appendBlock(mod.modResults.contents, SETTINGS_MARKER, SETTINGS_BLOCK);
    return mod;
  });

  return withProjectBuildGradle(config, (mod) => {
    mod.modResults.contents = appendBlock(
      mod.modResults.contents,
      PROJECT_BUILD_MARKER,
      PROJECT_BUILD_BLOCK
    );
    return mod;
  });
}

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = addReleaseSigning(mod.modResults.contents);
    return mod;
  });
}

function withProfileableRelease(config) {
  return withAndroidManifest(config, (mod) => {
    AndroidConfig.Manifest.ensureToolsAvailable(mod.modResults);
    ensureOptionalCameraFeature(mod.modResults);
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.profileable = [
      {
        $: {
          'android:shell': 'true',
          'tools:targetApi': '29',
        },
      },
    ];
    return mod;
  });
}

function ensureOptionalCameraFeature(androidManifest) {
  const manifest = androidManifest.manifest;
  const features = manifest['uses-feature'] ?? [];
  const cameraFeature = features.find(
    (feature) => feature.$?.['android:name'] === CAMERA_FEATURE
  );

  if (cameraFeature) {
    cameraFeature.$['android:required'] = 'false';
  } else {
    features.push({
      $: {
        'android:name': CAMERA_FEATURE,
        'android:required': 'false',
      },
    });
  }
  manifest['uses-feature'] = features;
}

function withAstraAndroidRelease(config) {
  config = withVendoredKotlinAudio(config);
  config = withReleaseSigning(config);
  return withProfileableRelease(config);
}

module.exports = withAstraAndroidRelease;
module.exports._internal = {
  PROJECT_BUILD_MARKER,
  SETTINGS_MARKER,
  SIGNING_MARKER,
  addReleaseSigning,
  appendBlock,
  ensureOptionalCameraFeature,
};
