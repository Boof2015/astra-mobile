const fs = require('fs/promises');
const path = require('path');
const {
  AndroidConfig,
  withDangerousMod,
  withAndroidManifest,
  withAppBuildGradle,
  withProjectBuildGradle,
  withSettingsGradle,
} = require('expo/config-plugins');

const SETTINGS_MARKER = '// ASTRA VENDORED KOTLIN AUDIO';
const PROJECT_BUILD_MARKER = '// ASTRA KOTLIN AUDIO SUBSTITUTION';
const SIGNING_MARKER = '// ASTRA RELEASE SIGNING';
const CAMERA_FEATURE = 'android.hardware.camera';
const NOTIFICATION_ICON_FILE = 'astra_notification_icon.xml';
const NOTIFICATION_OVERRIDE_FILE = 'astra_notification_icon_overrides.xml';

// A notification small icon is an alpha mask: Android supplies the color for
// the status bar, lock screen and media controls. Keep only the main Astra mark
// here—launcher backgrounds, shadows and brand colors do not belong in it.
const NOTIFICATION_ICON_VECTOR = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="1024"
    android:viewportHeight="1024">
    <group
        android:scaleX="1.726813"
        android:scaleY="1.726813"
        android:translateX="-660.505902"
        android:translateY="-373.7">
        <path
            android:fillColor="#FFFFFFFF"
            android:pathData="M526.083,500.65C529.86,496.662 535.112,494.402 540.605,494.402C553.071,494.402 576.056,494.402 588.831,494.402C594.652,494.402 600.185,496.939 603.984,501.35C610.054,508.396 619.61,519.49 627.207,528.31C633.905,536.085 633.631,547.668 626.573,555.117C603.295,579.689 553.937,631.788 536.916,649.755C533.139,653.742 527.889,656 522.397,656L452,656C440.954,656 432,647.046 432,636C432,626.32 432,615.247 432,607.967C432,602.851 433.96,597.93 437.478,594.215C454.783,575.942 508.184,519.551 526.083,500.65Z" />
        <path
            android:fillColor="#FFFFFFFF"
            android:pathData="M580,389.237C580,378.578 588.641,369.937 599.3,369.937C625.097,369.937 669.782,369.937 688.899,369.937C694.682,369.937 700.183,372.436 703.987,376.792C736.676,414.222 893.163,593.401 921.571,625.929C924.427,629.198 926,633.392 926,637.733C926,637.733 926,637.734 926,637.734C926,648.379 917.371,657.008 906.726,657.008L817.1,657.008C811.318,657.008 805.817,654.51 802.013,650.155C769.332,612.742 612.909,433.673 584.448,401.092C581.58,397.809 580,393.598 580,389.239C580,389.238 580,389.237 580,389.237Z" />
    </group>
</vector>
`;

// RNTP 4.1.2 uses ExoPlayer's generic circular-play drawable whenever no JS
// icon resolves. An app-level resource with the same name overrides that
// default in release, debug and the temporary foreground-service notification.
const NOTIFICATION_ICON_OVERRIDE = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <item name="exo_notification_small_icon" type="drawable">@drawable/astra_notification_icon</item>
</resources>
`;

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

async function writeNotificationIconResources(platformProjectRoot) {
  const resourceRoot = path.join(platformProjectRoot, 'app', 'src', 'main', 'res');
  const drawableDir = path.join(resourceRoot, 'drawable');
  const valuesDir = path.join(resourceRoot, 'values');

  await Promise.all([
    fs.mkdir(drawableDir, { recursive: true }),
    fs.mkdir(valuesDir, { recursive: true }),
  ]);
  await Promise.all([
    fs.writeFile(path.join(drawableDir, NOTIFICATION_ICON_FILE), NOTIFICATION_ICON_VECTOR),
    fs.writeFile(path.join(valuesDir, NOTIFICATION_OVERRIDE_FILE), NOTIFICATION_ICON_OVERRIDE),
  ]);
}

function withAstraNotificationIcon(config) {
  return withDangerousMod(config, [
    'android',
    async (mod) => {
      await writeNotificationIconResources(mod.modRequest.platformProjectRoot);
      return mod;
    },
  ]);
}

function withAstraAndroidRelease(config) {
  config = withVendoredKotlinAudio(config);
  config = withReleaseSigning(config);
  config = withAstraNotificationIcon(config);
  return withProfileableRelease(config);
}

module.exports = withAstraAndroidRelease;
module.exports._internal = {
  PROJECT_BUILD_MARKER,
  SETTINGS_MARKER,
  SIGNING_MARKER,
  NOTIFICATION_ICON_FILE,
  NOTIFICATION_ICON_VECTOR,
  NOTIFICATION_OVERRIDE_FILE,
  NOTIFICATION_ICON_OVERRIDE,
  addReleaseSigning,
  appendBlock,
  ensureOptionalCameraFeature,
  writeNotificationIconResources,
};
