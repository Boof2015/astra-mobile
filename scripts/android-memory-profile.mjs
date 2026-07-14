#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_PACKAGE = 'io.github.boof2015.astra';

function numberMatch(text, pattern, group = 1) {
  const match = text.match(pattern);
  return match ? Number(match[group]) : null;
}

function appSummaryBucket(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^\\s*${escaped}:\\s+(\\d+)(?:\\s+(\\d+))?`, 'm'));
  return match ? { pssKb: Number(match[1]), rssKb: match[2] ? Number(match[2]) : null } : null;
}

export function parseMeminfo(text) {
  const total = text.match(
    /TOTAL PSS:\s*(\d+)\s+TOTAL RSS:\s*(\d+)\s+TOTAL SWAP PSS:\s*(\d+)/
  );
  const bitmapMalloced = text.match(/^\s*Bitmap \(malloced\):\s+(\d+)\s+(\d+)/m);
  const bitmapNonmalloced = text.match(/^\s*Bitmap \(nonmalloced\):\s+(\d+)\s+(\d+)/m);
  const mallocedKb = bitmapMalloced ? Number(bitmapMalloced[2]) : 0;
  const nonmallocedKb = bitmapNonmalloced ? Number(bitmapNonmalloced[2]) : 0;

  return {
    totalPssKb: total ? Number(total[1]) : null,
    totalRssKb: total ? Number(total[2]) : null,
    totalSwapPssKb: total ? Number(total[3]) : null,
    buckets: {
      javaHeap: appSummaryBucket(text, 'Java Heap'),
      nativeHeap: appSummaryBucket(text, 'Native Heap'),
      graphics: appSummaryBucket(text, 'Graphics'),
      privateOther: appSummaryBucket(text, 'Private Other'),
      system: appSummaryBucket(text, 'System'),
    },
    mtrack: {
      eglKb: numberMatch(text, /^\s*EGL mtrack\s+(\d+)/m),
      glKb: numberMatch(text, /^\s*GL mtrack\s+(\d+)/m),
    },
    bitmaps: {
      mallocedCount: bitmapMalloced ? Number(bitmapMalloced[1]) : 0,
      mallocedKb,
      nonmallocedCount: bitmapNonmalloced ? Number(bitmapNonmalloced[1]) : 0,
      nonmallocedKb,
      totalKb: mallocedKb + nonmallocedKb,
    },
  };
}

export function parseGfxinfo(text) {
  const textureViews = [...text.matchAll(/^TextureView:\s*(\d+)x(\d+)\s*$/gm)].map(
    (match) => ({ width: Number(match[1]), height: Number(match[2]) })
  );
  return {
    textureViewCount: textureViews.length,
    textureViews,
    graphicBufferAllocatedKb: numberMatch(
      text,
      /Total allocated by GraphicBufferAllocator \(estimate\):\s*([\d.]+) KB/
    ),
    gpuMemoryBytes: numberMatch(
      text,
      /Total GPU memory usage:\s*\n\s*(\d+) bytes/
    ),
    glLayerCount: numberMatch(text, /Layers Total\s+[\d.]+ KB \(numLayers = (\d+)\)/),
  };
}

export function buildMemoryProfile(meminfo, gfxinfo, metadata = {}) {
  const memory = parseMeminfo(meminfo);
  const graphics = parseGfxinfo(gfxinfo);
  return {
    capturedAt: new Date().toISOString(),
    package: metadata.package ?? DEFAULT_PACKAGE,
    label: metadata.label ?? null,
    serial: metadata.serial ?? null,
    memory,
    graphics,
    acceptance: {
      stretchPssAtOrBelow300Mb:
        memory.totalPssKb !== null ? memory.totalPssKb <= 300 * 1024 : null,
      hardPssBelow400Mb:
        memory.totalPssKb !== null ? memory.totalPssKb < 400 * 1024 : null,
      graphicsBelow150Mb:
        memory.buckets.graphics?.pssKb !== undefined &&
        memory.buckets.graphics?.pssKb !== null
          ? memory.buckets.graphics.pssKb < 150 * 1024
          : null,
    },
  };
}

function mb(kb) {
  return kb === null || kb === undefined ? 'n/a' : `${(kb / 1024).toFixed(1)} MB`;
}

function printHuman(profile) {
  const { memory, graphics } = profile;
  const rows = [
    ['Total PSS', mb(memory.totalPssKb)],
    ['Total RSS', mb(memory.totalRssKb)],
    ['Swap PSS', mb(memory.totalSwapPssKb)],
    ['Java heap PSS', mb(memory.buckets.javaHeap?.pssKb)],
    ['Native heap PSS', mb(memory.buckets.nativeHeap?.pssKb)],
    ['Graphics PSS', mb(memory.buckets.graphics?.pssKb)],
    ['EGL mtrack', mb(memory.mtrack.eglKb)],
    ['GL mtrack', mb(memory.mtrack.glKb)],
    ['Tracked bitmaps', mb(memory.bitmaps.totalKb)],
    ['TextureViews', String(graphics.textureViewCount)],
    ['Graphic buffers', mb(graphics.graphicBufferAllocatedKb)],
    ['GPU cache/layers', graphics.gpuMemoryBytes === null ? 'n/a' : mb(graphics.gpuMemoryBytes / 1024)],
  ];
  const width = Math.max(...rows.map(([name]) => name.length));

  console.log(`Astra Android memory profile${profile.label ? ` — ${profile.label}` : ''}`);
  console.log(`${profile.package}${profile.serial ? ` on ${profile.serial}` : ''}`);
  for (const [name, value] of rows) console.log(`${name.padEnd(width)}  ${value}`);
  if (graphics.textureViews.length > 0) {
    console.log(`TextureView sizes${' '.repeat(Math.max(1, width - 16))}  ${graphics.textureViews.map((v) => `${v.width}x${v.height}`).join(', ')}`);
  }
  console.log(
    `Gates${' '.repeat(Math.max(1, width - 5))}  stretch<=300MB=${profile.acceptance.stretchPssAtOrBelow300Mb} ` +
      `hard<400MB=${profile.acceptance.hardPssBelow400Mb} graphics<150MB=${profile.acceptance.graphicsBelow150Mb}`
  );
}

function parseArgs(args) {
  const result = { package: DEFAULT_PACKAGE, label: null, serial: null, json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') result.json = true;
    else if (arg === '--package') result.package = args[++i];
    else if (arg === '--label') result.label = args[++i];
    else if (arg === '--serial') result.serial = args[++i];
    else if (arg === '--help' || arg === '-h') result.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function adbOutput(serial, commandArgs) {
  const serialArgs = serial ? ['-s', serial] : [];
  return execFileSync('adb', [...serialArgs, 'shell', 'dumpsys', ...commandArgs], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log('Usage: node scripts/android-memory-profile.mjs [--package id] [--serial id] [--label name] [--json]');
    return;
  }
  const meminfo = adbOutput(options.serial, ['meminfo', options.package]);
  if (!meminfo.includes('TOTAL PSS:')) {
    throw new Error(`No running process found for ${options.package}`);
  }
  const gfxinfo = adbOutput(options.serial, ['gfxinfo', options.package]);
  const profile = buildMemoryProfile(meminfo, gfxinfo, options);
  if (options.json) console.log(JSON.stringify(profile, null, 2));
  else printHuman(profile);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
