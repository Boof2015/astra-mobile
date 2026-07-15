const packageJson = require('./package.json');
const release = require('./release.json');

const DISTRIBUTIONS = new Set(['development', 'github', 'google-play']);
const BLOCKED_ANDROID_PERMISSIONS = [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.RECORD_AUDIO',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];

module.exports = ({ config }) => {
  const distribution = (process.env.ASTRA_DISTRIBUTION ?? 'development').trim();
  if (!DISTRIBUTIONS.has(distribution)) {
    throw new Error(
      `ASTRA_DISTRIBUTION must be one of ${Array.from(DISTRIBUTIONS).join(', ')}; received ${JSON.stringify(distribution)}.`
    );
  }

  if (!Number.isInteger(release.androidVersionCode) || release.androidVersionCode <= 0) {
    throw new Error('release.json androidVersionCode must be a positive integer.');
  }

  return {
    ...config,
    version: packageJson.version,
    android: {
      ...config.android,
      versionCode: release.androidVersionCode,
      blockedPermissions: BLOCKED_ANDROID_PERMISSIONS,
    },
    extra: {
      ...config.extra,
      distribution,
    },
  };
};
