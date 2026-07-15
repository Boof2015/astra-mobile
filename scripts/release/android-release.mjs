import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const PACKAGE_ID = 'io.github.boof2015.astra';
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

const DISTRIBUTIONS = {
  github: {
    artifactSuffix: 'GitHub-arm-universal',
    extension: 'apk',
    label: 'GitHub',
  },
  'google-play': {
    artifactSuffix: 'GooglePlay',
    extension: 'aab',
    label: 'Google Play',
  },
};

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

export function getReleaseIdentity(distribution) {
  const distributionConfig = DISTRIBUTIONS[distribution];
  if (!distributionConfig) {
    throw new Error(`Unsupported distribution ${JSON.stringify(distribution)}.`);
  }

  const packageJson = readJson('package.json');
  const packageLock = readJson('package-lock.json');
  const release = readJson('release.json');
  const appJson = readJson('app.json');
  const versionName = packageJson.version;
  const versionCode = release.androidVersionCode;

  if (typeof versionName !== 'string' || !SEMVER_PATTERN.test(versionName)) {
    throw new Error(`package.json version must be valid SemVer; received ${JSON.stringify(versionName)}.`);
  }
  if (packageLock.version !== versionName || packageLock.packages?.['']?.version !== versionName) {
    throw new Error('package-lock.json root versions must match package.json version. Run npm install after changing the version.');
  }
  if (!Number.isInteger(versionCode) || versionCode <= 0) {
    throw new Error('release.json androidVersionCode must be a positive integer.');
  }
  if (appJson.expo?.version !== undefined) {
    throw new Error('app.json must not duplicate the app version; app.config.js reads it from package.json.');
  }
  if (appJson.expo?.android?.package !== PACKAGE_ID) {
    throw new Error(`Android package ID must remain ${PACKAGE_ID}.`);
  }
  if (!appJson.expo?.plugins?.includes('./plugins/withAstraAndroidRelease')) {
    throw new Error('The Astra Android release config plugin is missing from app.json.');
  }

  const previousDistribution = process.env.ASTRA_DISTRIBUTION;
  process.env.ASTRA_DISTRIBUTION = distribution;
  let resolvedConfig;
  try {
    const createAppConfig = require(path.join(ROOT, 'app.config.js'));
    resolvedConfig = createAppConfig({ config: appJson.expo });
  } finally {
    if (previousDistribution === undefined) {
      delete process.env.ASTRA_DISTRIBUTION;
    } else {
      process.env.ASTRA_DISTRIBUTION = previousDistribution;
    }
  }

  if (
    resolvedConfig.version !== versionName ||
    resolvedConfig.android?.versionCode !== versionCode ||
    resolvedConfig.extra?.distribution !== distribution
  ) {
    throw new Error('Resolved Expo version, version code, or distribution does not match the tracked release identity.');
  }

  return {
    artifactFileName: `Astra-${versionName}-${versionCode}-${distributionConfig.artifactSuffix}.${distributionConfig.extension}`,
    distribution,
    distributionLabel: distributionConfig.label,
    packageId: PACKAGE_ID,
    versionCode,
    versionName,
  };
}

export function prepareArtifact(distribution, sourcePath, outputDirectory) {
  const identity = getReleaseIdentity(distribution);
  const absoluteSource = path.resolve(ROOT, sourcePath);
  const absoluteOutput = path.resolve(ROOT, outputDirectory);
  const artifactPath = path.join(absoluteOutput, identity.artifactFileName);

  mkdirSync(absoluteOutput, { recursive: true });
  copyFileSync(absoluteSource, artifactPath);

  const artifactBytes = readFileSync(artifactPath);
  const sha256 = createHash('sha256').update(artifactBytes).digest('hex');
  writeFileSync(`${artifactPath}.sha256`, `${sha256}  ${identity.artifactFileName}\n`, 'utf8');

  const metadata = {
    schemaVersion: 1,
    ...identity,
    source: {
      commit: process.env.GITHUB_SHA ?? null,
      repository: process.env.GITHUB_REPOSITORY ?? null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      runId: process.env.GITHUB_RUN_ID ?? null,
    },
    artifact: {
      fileName: identity.artifactFileName,
      sha256,
      sizeBytes: statSync(artifactPath).size,
    },
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(absoluteOutput, 'build-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

  return { artifactPath, metadata };
}

export function verifyApkMetadata(distribution, metadataPath) {
  const identity = getReleaseIdentity(distribution);
  const metadata = readJson(path.relative(ROOT, path.resolve(ROOT, metadataPath)));
  const element = metadata.elements?.[0];

  if (
    metadata.applicationId !== identity.packageId ||
    element?.versionCode !== identity.versionCode ||
    element?.versionName !== identity.versionName
  ) {
    throw new Error(
      `APK metadata does not match ${identity.packageId} ${identity.versionName} (${identity.versionCode}).`
    );
  }

  return identity;
}

function printUsage() {
  console.error('Usage: node scripts/release/android-release.mjs validate <github|google-play>');
  console.error('   or: node scripts/release/android-release.mjs prepare <github|google-play> <source> <output-directory>');
  console.error('   or: node scripts/release/android-release.mjs verify-apk-metadata github <output-metadata.json>');
}

function main() {
  const [command, distribution, sourcePath, outputDirectory] = process.argv.slice(2);
  if (command === 'validate' && distribution && !sourcePath && !outputDirectory) {
    const identity = getReleaseIdentity(distribution);
    console.log(`Validated ${identity.distributionLabel} ${identity.versionName} (${identity.versionCode}).`);
    return;
  }
  if (command === 'prepare' && distribution && sourcePath && outputDirectory) {
    const result = prepareArtifact(distribution, sourcePath, outputDirectory);
    console.log(`Prepared ${path.relative(ROOT, result.artifactPath)}.`);
    return;
  }
  if (command === 'verify-apk-metadata' && distribution === 'github' && sourcePath && !outputDirectory) {
    const identity = verifyApkMetadata(distribution, sourcePath);
    console.log(`Verified APK metadata for ${identity.versionName} (${identity.versionCode}).`);
    return;
  }

  printUsage();
  process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
