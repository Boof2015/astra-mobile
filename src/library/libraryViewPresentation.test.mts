import assert from 'node:assert/strict';
import test from 'node:test';
import {
  flashListInitialAnchor,
  flashListMaintainsVisiblePosition,
  libraryContextBarVisible,
  libraryContextBottomClearance,
  libraryContextOverlayHeight,
  libraryRailBottomClearance,
  libraryContextScrimHeight,
  libraryDockSectionWidth,
  libraryDockShowsActiveLabel,
  libraryDockSwipeDistance,
  libraryDockTargetWidths,
  resolveLibraryDockSwipe,
} from './libraryViewPresentation.ts';
import { adjacentLibraryViewMode } from './libraryViewMode.ts';
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

test('only a positive A-Z window maintains its visible item while prepending', () => {
  assert.equal(flashListMaintainsVisiblePosition(0), false);
  assert.equal(flashListMaintainsVisiblePosition(-1), false);
  assert.equal(flashListMaintainsVisiblePosition(1), true);
  assert.equal(flashListMaintainsVisiblePosition(137), true);
});

test('the direct dock keeps all five section targets usable on phone widths', () => {
  for (const width of [320, 360, 411]) {
    for (const fontScale of [1, 1.2, 2]) {
      const sectionWidth = libraryDockSectionWidth(width);
      const labelled = libraryDockShowsActiveLabel(width, fontScale);
      const targets = libraryDockTargetWidths(sectionWidth, labelled);
      assert.ok(
        targets.inactive >= 40,
        `${width}dp/${fontScale}x: ${targets.inactive}dp target`
      );
      assert.ok(targets.active >= targets.inactive);
    }
  }
});

test('folders reserves the same trailing action geometry as every other section', () => {
  for (const width of [320, 360, 411]) {
    assert.equal(libraryDockSectionWidth(width), width - 24 - 88);
  }
});

test('active labels only appear when width and text scale leave enough room', () => {
  assert.equal(libraryDockShowsActiveLabel(320, 1), false);
  assert.equal(libraryDockShowsActiveLabel(360, 1), true);
  assert.equal(libraryDockShowsActiveLabel(411, 1), true);
  assert.equal(libraryDockShowsActiveLabel(360, 1.2), false);
  assert.equal(libraryDockShowsActiveLabel(411, 2), false);
});

test('swipe priming uses the same distance as swipe commitment', () => {
  assert.equal(libraryDockSwipeDistance(208), 33.28);
  assert.equal(libraryDockSwipeDistance(248), 39.68);
  assert.equal(libraryDockSwipeDistance(500), 56);
  assert.equal(libraryDockSwipeDistance(0), 32);
});

test('dock swipes require deliberate distance or velocity and follow reading order', () => {
  assert.equal(resolveLibraryDockSwipe({ translationX: -40, velocityX: 0, width: 208 }), 1);
  assert.equal(resolveLibraryDockSwipe({ translationX: 40, velocityX: 0, width: 208 }), -1);
  assert.equal(resolveLibraryDockSwipe({ translationX: -15, velocityX: -600, width: 208 }), 1);
  assert.equal(resolveLibraryDockSwipe({ translationX: 15, velocityX: 600, width: 208 }), -1);
  assert.equal(resolveLibraryDockSwipe({ translationX: 11, velocityX: 900, width: 208 }), null);
  assert.equal(resolveLibraryDockSwipe({ translationX: 20, velocityX: 200, width: 208 }), null);
});

test('dock swipes stop at catalog edges', () => {
  assert.equal(adjacentLibraryViewMode('albums', -1), undefined);
  assert.equal(adjacentLibraryViewMode('albums', 1), 'artists');
  assert.equal(adjacentLibraryViewMode('tracks', -1), 'artists');
  assert.equal(adjacentLibraryViewMode('tracks', 1), 'playlists');
  assert.equal(adjacentLibraryViewMode('folders', -1), 'playlists');
  assert.equal(adjacentLibraryViewMode('folders', 1), undefined);
});

test('phone chrome only reserves the player footprint while it is visible', () => {
  assert.equal(libraryContextBottomClearance(76, true), 76);
  assert.equal(libraryContextBottomClearance(76, false), 8);
  assert.equal(libraryContextBottomClearance(-10, true), 0);
});

test('only phone layout and an explicit library status can hide the section bar', () => {
  assert.equal(libraryContextBarVisible(true, false), true);
  assert.equal(libraryContextBarVisible(false, false), false);
  assert.equal(libraryContextBarVisible(true, true), false);
  assert.equal(libraryContextBarVisible(false, true), false);
});

test('the floating bar reserves its end-of-list runway while the fade starts above it', () => {
  assert.equal(libraryContextOverlayHeight(76), 136);
  assert.equal(libraryContextScrimHeight(76), 184);
  assert.equal(libraryContextOverlayHeight(8), 68);
  assert.equal(libraryContextScrimHeight(8), 116);
});

test('the alphabet rail clears phone Library chrome but keeps the wide-screen boundary', () => {
  assert.equal(libraryRailBottomClearance(true, 136), 136);
  assert.equal(libraryRailBottomClearance(true, -1), 0);
  assert.equal(libraryRailBottomClearance(false, 136), 0);
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
