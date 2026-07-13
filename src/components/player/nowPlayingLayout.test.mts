import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getNowPlayingLayout,
  getTabletCompanionLayout,
} from './nowPlayingLayout.ts';

const BASELINES = [
  [320, 568, false, 296, 134, 204, 58],
  [320, 568, true, 296, 96, 204, 58],
  [360, 640, false, 328, 206, 214, 58],
  [360, 640, true, 328, 96, 214, 58],
  [393, 852, false, 361, 336, 361, 76],
  [393, 852, true, 361, 234, 361, 76],
  [412, 915, false, 380, 336, 380, 82],
  [412, 915, true, 380, 248, 380, 82],
  [600, 840, false, 520, 394, 394, 58],
  [600, 840, true, 520, 262, 394, 58],
  [800, 600, false, 768, 383, 383, 58],
  [800, 600, true, 768, 383, 506, 58],
] as const;

test('preserves existing non-companion media geometry', () => {
  for (const [width, height, visualizer, contentWidth, artSize, mediaHeight, waveform] of BASELINES) {
    const layout = getNowPlayingLayout(width, height, visualizer);
    assert.deepEqual(
      [layout.contentWidth, layout.artSize, layout.mediaStackHeight, layout.waveformHeight],
      [contentWidth, artSize, mediaHeight, waveform],
      `${width}x${height}, visualizer=${visualizer}`
    );
  }
});

test('keeps the lower-content anchor stable when the analyzer toggles', () => {
  for (const [width, height] of [
    [320, 568],
    [360, 640],
    [393, 852],
    [412, 915],
    [600, 840],
  ]) {
    const hidden = getNowPlayingLayout(width, height, false);
    const visible = getNowPlayingLayout(width, height, true);
    assert.equal(visible.mediaStackHeight, hidden.mediaStackHeight);
    assert.equal(visible.mediaTopMargin, hidden.mediaTopMargin);
    assert.equal(visible.mediaBottomGap, hidden.mediaBottomGap);
  }
});

test('caps visualizer-off artwork on roomy phones without shrinking the media stage', () => {
  for (const [width, height] of [
    [393, 852],
    [412, 915],
  ]) {
    const hidden = getNowPlayingLayout(width, height, false);
    assert.equal(hidden.artSize, 336);
    assert.ok(hidden.mediaStackHeight > hidden.artSize);
  }
});

test('adds the companion only to roomy tablet canvases', () => {
  for (const [width, height] of [
    [320, 568],
    [360, 640],
    [393, 852],
    [412, 915],
    [600, 840],
    [800, 600],
  ]) {
    assert.equal(getTabletCompanionLayout(width, height, true), null);
  }

  for (const [width, height] of [
    [768, 1024],
    [1024, 600],
    [1024, 768],
    [1366, 1024],
  ]) {
    const layout = getTabletCompanionLayout(width, height, true);
    assert.ok(layout, `${width}x${height} should qualify`);
    assert.ok(layout.companionWidth >= 320 && layout.companionWidth <= 400);
    assert.ok(layout.playerRegionWidth > 0);
    assert.ok(layout.shellWidth <= 1200);
    assert.equal(
      layout.playerRegionWidth + layout.gap + layout.companionWidth,
      layout.shellWidth
    );
  }
});

test('keeps calculated dimensions finite and non-negative', () => {
  for (const [width, height] of [
    [320, 568],
    [360, 640],
    [393, 852],
    [412, 915],
    [600, 840],
    [800, 600],
    [768, 1024],
    [1024, 600],
    [1024, 768],
    [1366, 1024],
  ]) {
    for (const visualizer of [false, true]) {
      const layout = getNowPlayingLayout(width, height, visualizer);
      for (const value of Object.values(layout)) {
        if (typeof value !== 'number') continue;
        assert.ok(Number.isFinite(value));
        assert.ok(value >= 0);
      }
    }
  }
});
