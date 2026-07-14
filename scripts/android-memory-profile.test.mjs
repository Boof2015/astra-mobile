import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMemoryProfile, parseGfxinfo, parseMeminfo } from './android-memory-profile.mjs';

const MEMINFO = `
  EGL mtrack    80004    80004        0        0    80004
   GL mtrack   395072   395072        0        0   395072
 App Summary
           Java Heap:    63956                         101768
         Native Heap:    81616                         104420
            Graphics:   475076                         475076
       Private Other:   116172
              System:   232359
           TOTAL PSS:  1036907            TOTAL RSS:   959676       TOTAL SWAP PSS:   224950
 Native Allocations
   Bitmap (malloced):       38                          35541
Bitmap (nonmalloced):        5                          25671
`;

const GFXINFO = `
  Layers Total         14188.36 KB (numLayers = 4)
Total GPU memory usage:
  36152084 bytes, 34.48 MB (2.05 KB is purgeable)
TextureView: 1440x562
TextureView: 1560x1298
TextureView: 1350x378
Total allocated by GraphicBufferAllocator (estimate): 109727.50 KB
`;

test('parses Android PSS, RSS, heap, graphics, swap, and bitmap buckets', () => {
  const parsed = parseMeminfo(MEMINFO);
  assert.equal(parsed.totalPssKb, 1036907);
  assert.equal(parsed.totalRssKb, 959676);
  assert.equal(parsed.totalSwapPssKb, 224950);
  assert.equal(parsed.buckets.javaHeap?.pssKb, 63956);
  assert.equal(parsed.buckets.nativeHeap?.pssKb, 81616);
  assert.equal(parsed.buckets.graphics?.pssKb, 475076);
  assert.equal(parsed.mtrack.glKb, 395072);
  assert.equal(parsed.bitmaps.totalKb, 61212);
});

test('parses TextureViews, GPU bytes, and GraphicBufferAllocator totals', () => {
  const parsed = parseGfxinfo(GFXINFO);
  assert.equal(parsed.textureViewCount, 3);
  assert.deepEqual(parsed.textureViews[0], { width: 1440, height: 562 });
  assert.equal(parsed.gpuMemoryBytes, 36152084);
  assert.equal(parsed.graphicBufferAllocatedKb, 109727.5);
  assert.equal(parsed.glLayerCount, 4);
});

test('reports the agreed memory acceptance gates', () => {
  const profile = buildMemoryProfile(MEMINFO, GFXINFO);
  assert.equal(profile.acceptance.stretchPssAtOrBelow300Mb, false);
  assert.equal(profile.acceptance.hardPssBelow400Mb, false);
  assert.equal(profile.acceptance.graphicsBelow150Mb, false);
});
