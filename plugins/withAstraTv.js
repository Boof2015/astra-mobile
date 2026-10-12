const fs = require('fs/promises');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

function configureTvManifest(androidManifest) {
  const manifest = androidManifest.manifest;
  const features = manifest['uses-feature'] ??= [];
  for (const name of ['android.software.leanback', 'android.hardware.touchscreen']) {
    let feature = features.find(item => item.$?.['android:name'] === name);
    if (!feature) { feature = { $: { 'android:name': name } }; features.push(feature); }
    feature.$['android:required'] = 'false';
  }
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  application.$['android:banner'] = '@drawable/astra_tv_banner';
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(androidManifest);
  const launcher = activity['intent-filter'].find(filter => filter.action?.some(action => action.$['android:name'] === 'android.intent.action.MAIN'));
  const categories = launcher.category ??= [];
  if (!categories.some(item => item.$['android:name'] === 'android.intent.category.LEANBACK_LAUNCHER')) {
    categories.push({ $: { 'android:name': 'android.intent.category.LEANBACK_LAUNCHER' } });
  }
  return androidManifest;
}

function vector(width, height, viewportWidth, viewportHeight, content) {
  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${width}dp" android:height="${height}dp"
    android:viewportWidth="${viewportWidth}" android:viewportHeight="${viewportHeight}">
${content}
</vector>
`;
}

function artwork(paths, width, canvasWidth, canvasHeight, sourceWidth, sourceHeight) {
  const scale = width / sourceWidth;
  return `    <group android:scaleX="${scale}" android:scaleY="${scale}"
        android:translateX="${(canvasWidth - width) / 2}" android:translateY="${(canvasHeight - sourceHeight * scale) / 2}">
${paths.map(item => `        <path android:fillColor="${item.fill}" android:pathData="${item.d}" />`).join('\n')}
    </group>`;
}

async function writeTvResources(projectRoot, androidRoot) {
  // These are the supplied brand vectors, not font-rendered approximations.
  const svg = await fs.readFile(path.join(projectRoot, 'assets/branding/astra-full.svg'), 'utf8');
  const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*\bstyle="([^"]+)"[^>]*\/>/g)]
    .map(([, d, style]) => ({ d, fill: style.match(/fill:([^;]+)/)?.[1] }));
  if (!svg.includes('viewBox="0 0 1625 182"') || paths.length !== 7 || paths.some(item => !item.fill)) {
    throw new Error('The Astra wordmark geometry changed; update the TV vector conversion.');
  }
  const mark = paths.filter(item => item.fill !== '#fff');
  const foreground = vector(108, 108, 108, 108, artwork(mark, 48, 108, 108, 312.114, 182));
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/iconBackground" />
    <foreground android:drawable="@drawable/astra_tv_icon_foreground" />
</adaptive-icon>
`;
  const background = (shape) => `    <path android:fillColor="#05070A" android:pathData="${shape}" />\n`;
  const banner = vector(160, 90, 320, 180,
    background('M0,0h320v180h-320z') + artwork(paths, 272, 320, 180, 1625, 182));
  const legacy = vector(80, 80, 72, 72,
    background('M0,0h72v72h-72z') + artwork(mark, 48, 72, 72, 312.114, 182));
  const round = vector(80, 80, 72, 72,
    background('M36,0a36,36 0,1 1,0,72a36,36 0,1 1,0,-72') + artwork(mark, 48, 72, 72, 312.114, 182));
  // UI-mode qualifiers leave Expo's phone/tablet icons untouched, including
  // older TVs and launchers that request the round resource explicitly.
  const resources = {
    'drawable/astra_tv_banner.xml': banner,
    'drawable/astra_tv_icon_foreground.xml': foreground,
    'mipmap-television-anydpi/ic_launcher.xml': legacy,
    'mipmap-television-anydpi/ic_launcher_round.xml': round,
    'mipmap-television-anydpi-v26/ic_launcher.xml': adaptive,
    'mipmap-television-anydpi-v26/ic_launcher_round.xml': adaptive,
  };
  for (const [file, xml] of Object.entries(resources)) {
    const destination = path.join(androidRoot, 'app/src/main/res', file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, xml);
  }
}

function withAstraTv(config) {
  config = withAndroidManifest(config, mod => {
    configureTvManifest(mod.modResults);
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    await writeTvResources(mod.modRequest.projectRoot, mod.modRequest.platformProjectRoot);
    return mod;
  }]);
}

module.exports = withAstraTv;
module.exports._internal = { configureTvManifest, writeTvResources };
