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

function hexColor(fill) {
  if (fill === 'white') return '#ffffff';
  const rgb = fill.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (rgb) return `#${rgb.slice(1).map(value => Number(value).toString(16).padStart(2, '0')).join('')}`;
  if (/^#[0-9a-f]{6}$/i.test(fill)) return fill;
  throw new Error(`Unsupported fill "${fill}" in the TV banner lockup.`);
}

/**
 * The brand SVG as vector-drawable groups and paths. Covers what the Affinity
 * exports contain: nested <g transform="matrix(s,0,0,s,x,y)"> (uniform scale
 * and translate) around flat-filled <path>s. Anything else throws, so a new
 * export can't render wrong without anyone noticing.
 */
function svgToVectorContent(svg) {
  const rootRule = svg.match(/<svg\b[^>]*fill-rule:(\w+)/)?.[1] ?? 'nonzero';
  const lines = [];
  let depth = 1;
  let paths = 0;
  for (const [, closing, tag, attributes] of svg.matchAll(/<(\/?)(g|path)\b([^>]*?)\/?>/g)) {
    const indent = '    '.repeat(depth);
    if (tag === 'g' && closing) {
      depth -= 1;
      lines.push(`${'    '.repeat(depth)}</group>`);
    } else if (tag === 'g') {
      const transform = attributes.match(/transform="([^"]+)"/)?.[1];
      let group = '<group>';
      if (transform) {
        const matrix = transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(',').map(Number);
        if (!matrix || matrix.length !== 6 || matrix[1] !== 0 || matrix[2] !== 0 || matrix[0] !== matrix[3]) {
          throw new Error(`Unsupported transform "${transform}" in the TV banner lockup.`);
        }
        const [scale, , , , x, y] = matrix;
        group = `<group android:scaleX="${scale}" android:scaleY="${scale}" android:translateX="${x}" android:translateY="${y}">`;
      }
      lines.push(`${indent}${group}`);
      depth += 1;
    } else {
      const d = attributes.match(/\bd="([^"]+)"/)?.[1];
      const style = attributes.match(/style="([^"]+)"/)?.[1] ?? '';
      const fill = style.match(/fill:([^;]+)/)?.[1] ?? attributes.match(/\bfill="([^"]+)"/)?.[1];
      if (!d || !fill) throw new Error('Every path in the TV banner lockup needs geometry and a flat fill.');
      const rule = style.match(/fill-rule:(\w+)/)?.[1] ?? rootRule;
      lines.push(`${indent}<path android:fillColor="${hexColor(fill)}" android:fillType="${rule === 'evenodd' ? 'evenOdd' : 'nonZero'}" android:pathData="${d}" />`);
      paths += 1;
    }
  }
  if (depth !== 1 || paths === 0) throw new Error('The TV banner lockup has unbalanced groups or no paths.');
  return lines.join('\n');
}

// Earlier builds drew a separate TV launcher icon. The TV now uses the app's
// own adaptive icon, so these must not survive a non-clean prebuild.
const RETIRED_TV_RESOURCES = [
  'drawable/astra_tv_icon_foreground.xml',
  'mipmap-television-anydpi/ic_launcher.xml',
  'mipmap-television-anydpi/ic_launcher_round.xml',
  'mipmap-television-anydpi-v26/ic_launcher.xml',
  'mipmap-television-anydpi-v26/ic_launcher_round.xml',
];

async function writeTvResources(projectRoot, androidRoot) {
  // The banner is the brand's own layers on one 1920×1080 canvas: the field as
  // an image (its grain can't be a vector) and the lockup as vector paths.
  const lockupSvg = await fs.readFile(path.join(projectRoot, 'assets/branding/tv-banner-lockup.svg'), 'utf8');
  if (!lockupSvg.includes('viewBox="0 0 1920 1080"')) {
    throw new Error('The TV banner lockup must share the 1920×1080 banner canvas.');
  }
  const lockup = vector(160, 90, 1920, 1080, svgToVectorContent(lockupSvg));
  const banner = `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:width="160dp" android:height="90dp" android:drawable="@drawable/astra_tv_banner_background" />
    <item android:width="160dp" android:height="90dp" android:drawable="@drawable/astra_tv_banner_lockup" />
</layer-list>
`;
  const resources = path.join(androidRoot, 'app/src/main/res');
  const files = {
    'drawable/astra_tv_banner.xml': banner,
    'drawable/astra_tv_banner_lockup.xml': lockup,
    'drawable-nodpi/astra_tv_banner_background.png': await fs.readFile(path.join(projectRoot, 'assets/branding/tv-banner-background.png')),
  };
  for (const [file, contents] of Object.entries(files)) {
    const destination = path.join(resources, file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, contents);
  }
  for (const file of RETIRED_TV_RESOURCES) {
    await fs.rm(path.join(resources, file), { force: true });
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
