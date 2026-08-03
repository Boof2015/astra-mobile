import assert from 'node:assert/strict';
import test from 'node:test';
import {
  flashListInitialAnchor,
  libraryContextActionCount,
  libraryContextBottomClearance,
  libraryContextOverlayHeight,
  libraryContextScrimHeight,
  libraryContextSectionWidth,
} from './libraryViewPresentation.ts';
import { effectiveMiniPlayerVisible } from '../playback/playbackTargetPresentation.ts';

test('the catalog head omits FlashList initialScrollIndex entirely', () => {
  for (const mode of ['albums', 'artists', 'tracks', 'playlists', 'folders']) {
    assert.equal(
      flashListInitialAnchor(0),
      undefined,
      `${mode} should mount at the native scroll origin`
    );
  }
  assert.equal(flashListInitialAnchor(-1), undefined);
  assert.equal(flashListInitialAnchor(Number.NaN), undefined);
});

test('a real A-Z anchor remains an explicit initial index', () => {
  assert.equal(flashListInitialAnchor(1), 1);
  assert.equal(flashListInitialAnchor(137), 137);
});

test('every phone command-bar action set leaves a useful section target', () => {
  for (const width of [320, 360, 411]) {
    for (const mode of ['albums', 'artists', 'tracks', 'playlists', 'folders'] as const) {
      const sectionWidth = libraryContextSectionWidth(
        width,
        libraryContextActionCount(mode)
      );
      assert.ok(sectionWidth >= 140, `${width}dp ${mode}: only ${sectionWidth}dp for section`);
    }
  }
});

test('phone chrome only reserves the player footprint while it is visible', () => {
  assert.equal(libraryContextBottomClearance(76, true), 76);
  assert.equal(libraryContextBottomClearance(76, false), 8);
  assert.equal(libraryContextBottomClearance(-10, true), 0);
});

test('the floating bar reserves its end-of-list runway while the fade starts above it', () => {
  assert.equal(libraryContextOverlayHeight(76), 136);
  assert.equal(libraryContextScrimHeight(76), 184);
  assert.equal(libraryContextOverlayHeight(8), 68);
  assert.equal(libraryContextScrimHeight(8), 116);
});

test('mini-player visibility mirrors target fallback semantics', () => {
  assert.equal(effectiveMiniPlayerVisible({
    selectedTarget: 'phone',
    phoneHasTrack: false,
    desktopConnected: true,
    desktopHasTrack: false,
  }), false);
  assert.equal(effectiveMiniPlayerVisible({
    selectedTarget: 'phone',
    phoneHasTrack: false,
    desktopConnected: true,
    desktopHasTrack: true,
  }), true);
  assert.equal(effectiveMiniPlayerVisible({
    selectedTarget: 'desktop',
    phoneHasTrack: true,
    desktopConnected: true,
    desktopHasTrack: false,
  }), true);
  assert.equal(effectiveMiniPlayerVisible({
    selectedTarget: 'desktop',
    phoneHasTrack: true,
    desktopConnected: false,
    desktopHasTrack: false,
  }), false);
});
