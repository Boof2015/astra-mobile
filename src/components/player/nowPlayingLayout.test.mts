import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getNowPlayingLayout,
  getScopeHeight,
  getTabletCompanionLayout,
  NOW_PLAYING_ART_COMFORT_MIN,
  NOW_PLAYING_CONTENT_BOTTOM_PADDING,
  NOW_PLAYING_CONTENT_TOP_PADDING,
  NOW_PLAYING_HEADER_HEIGHT,
  type NowPlayingLayout,
} from './nowPlayingLayout.ts';

/**
 * Windows are inset-adjusted, exactly as `NowPlayingOverlay` computes them:
 * window size minus safe areas, in dp.
 */
const DEVICES = [
  // The device this rebuild exists for: tall and narrow, and the one where the
  // old estimate error pooled into a dead gap above the badge row.
  { name: 'Poco M5', width: 393, height: 825 },
  { name: 'Pixel 7 Pro', width: 411, height: 819 },
  { name: 'Galaxy S22', width: 360, height: 732 },
  { name: 'Galaxy S22 Ultra', width: 411, height: 818 },
  { name: 'Galaxy S25 Ultra', width: 411, height: 852 },
  { name: 'OnePlus 7 Pro', width: 412, height: 871 },
  { name: 'Galaxy A15', width: 393, height: 825 },
  // Floors: small, very small, and a short split-screen sliver.
  { name: 'small 320x568', width: 320, height: 568 },
  { name: 'tiny 320x480', width: 320, height: 480 },
  { name: 'split-screen 393x420', width: 393, height: 420 },
] as const;

const FONT_SCALES = [1, 1.15, 1.3] as const;

const WIDE_WINDOWS = [
  [600, 840],
  [800, 600],
  [768, 1024],
  [1024, 600],
  [1024, 768],
  [1366, 1024],
] as const;

function columnHeight(availableHeight: number): number {
  return (
    availableHeight -
    NOW_PLAYING_CONTENT_TOP_PADDING -
    NOW_PLAYING_CONTENT_BOTTOM_PADDING -
    NOW_PLAYING_HEADER_HEIGHT
  );
}

function layoutFor(
  device: (typeof DEVICES)[number],
  fontScale: number,
  showVisualizer: boolean
): NowPlayingLayout {
  return getNowPlayingLayout(
    device.width,
    device.height,
    showVisualizer,
    false,
    fontScale
  );
}

test('renders an identical deck for every device in the same tier', () => {
  for (const fontScale of FONT_SCALES) {
    const byDensity = new Map<string, { device: string; height: number }>();
    for (const device of DEVICES) {
      const { density, deck } = layoutFor(device, fontScale, true);
      const seen = byDensity.get(density);
      if (seen) {
        assert.equal(
          deck.height,
          seen.height,
          `${device.name} and ${seen.device} are both '${density}' @${fontScale} but their decks differ (${deck.height} vs ${seen.height})`
        );
      } else {
        byDensity.set(density, { device: device.name, height: deck.height });
      }
    }
    assert.ok(byDensity.size > 0);
  }
});

test('reserves a deck exactly as tall as the rows it contains', () => {
  for (const fontScale of FONT_SCALES) {
    for (const device of DEVICES) {
      const { deck } = layoutFor(device, fontScale, true);
      // [lyric ─lyricGap─ identity] ─rowGap─
      // [progress ─controlGap─ transport] ─rowGap─ utility
      const identityGroup =
        deck.lyricRowHeight > 0
          ? deck.lyricRowHeight + deck.lyricGap + deck.identityRowHeight
          : deck.identityRowHeight;
      const controlGroup =
        deck.progressRowHeight + deck.controlGap + deck.transportRowHeight;
      const sum =
        identityGroup + controlGroup + deck.utilityRowHeight + deck.rowGap * 2;
      assert.equal(
        deck.height,
        sum,
        `${device.name} @${fontScale}: deck.height ${deck.height} != sum of rows ${sum}`
      );

      assert.equal(
        deck.identityRowHeight,
        deck.titleLineHeight + deck.identityGap + deck.artistLineHeight,
        `${device.name} @${fontScale}: identity row must be two declared line boxes`
      );
      assert.equal(
        deck.progressRowHeight,
        deck.waveformHeight +
          deck.waveformTouchPadding * 2 +
          deck.timesGap +
          deck.timesRowHeight,
        `${device.name} @${fontScale}: progress row must cover the seek bar's real footprint`
      );
    }
  }
});

test('fills the column with deck + stage and keeps the artwork inside it', () => {
  for (const fontScale of FONT_SCALES) {
    for (const device of DEVICES) {
      for (const visualizer of [false, true]) {
        const layout = layoutFor(device, fontScale, visualizer);
        assert.equal(
          layout.deck.height + layout.stageHeight,
          columnHeight(device.height),
          `${device.name} @${fontScale}: deck + stage must fill the column exactly`
        );
        const railSpace = visualizer && layout.scopeRailFits ? layout.scopeBlockHeight : 0;
        assert.ok(
          layout.artSize + railSpace + layout.stageInset * 2 <= layout.stageHeight,
          `${device.name} @${fontScale} scope=${visualizer}: art ${layout.artSize} + rail ${railSpace} + insets ${layout.stageInset * 2} overflows stage ${layout.stageHeight}`
        );
        assert.ok(
          layout.artSize <= layout.contentWidth,
          `${device.name} @${fontScale}: art ${layout.artSize} exceeds content width ${layout.contentWidth}`
        );
      }
    }
  }
});

test('toggling the scope moves nothing outside the stage', () => {
  for (const fontScale of FONT_SCALES) {
    for (const device of DEVICES) {
      const hidden = layoutFor(device, fontScale, false);
      const visible = layoutFor(device, fontScale, true);

      assert.equal(
        hidden.deck.height,
        visible.deck.height,
        `${device.name} @${fontScale}: the scope toggle changed the deck height`
      );
      assert.equal(
        hidden.stageHeight,
        visible.stageHeight,
        `${device.name} @${fontScale}: the scope toggle changed the stage height`
      );
      assert.equal(
        hidden.density,
        visible.density,
        `${device.name} @${fontScale}: the scope toggle changed the density tier`
      );
      // The art pair is the same regardless of the current toggle state...
      assert.equal(hidden.artSizeScopeOn, visible.artSizeScopeOn);
      assert.equal(hidden.artSizeScopeOff, visible.artSizeScopeOff);
      // ...and the resolved artSize picks the matching member.
      assert.equal(hidden.artSize, hidden.artSizeScopeOff);
      assert.equal(visible.artSize, visible.artSizeScopeOn);
      assert.equal(
        hidden.scopeRailFits,
        visible.scopeRailFits,
        `${device.name} @${fontScale}: the scope toggle changed whether the rail fits`
      );
      assert.ok(
        visible.artSizeScopeOn + visible.scopeBlockHeight + visible.stageInset * 2 <=
          visible.stageHeight,
        `${device.name} @${fontScale}: art + rail + insets must fit the stage in every tier`
      );
      assert.ok(
        visible.artSizeScopeOn <= visible.artSizeScopeOff,
        `${device.name} @${fontScale}: turning the scope on must not grow the artwork`
      );
    }
  }
});

test('picks the richest tier that still leaves comfortable artwork', () => {
  for (const fontScale of FONT_SCALES) {
    for (const device of DEVICES) {
      const layout = layoutFor(device, fontScale, true);
      if (layout.density === 'compact') continue;
      assert.ok(
        layout.artSizeScopeOn >= NOW_PLAYING_ART_COMFORT_MIN,
        `${device.name} @${fontScale}: tier '${layout.density}' left only ${layout.artSizeScopeOn}dp of artwork`
      );
    }
  }
});

test('never gives a taller window a leaner tier', () => {
  const rank = { compact: 0, regular: 1, spacious: 2 } as const;
  for (const fontScale of FONT_SCALES) {
    for (const width of [320, 360, 393, 411]) {
      let previous = -1;
      for (let height = 380; height <= 1000; height += 1) {
        const { density } = getNowPlayingLayout(width, height, true, false, fontScale);
        const current = rank[density];
        assert.ok(
          current >= previous,
          `width ${width} @${fontScale}: height ${height} dropped to '${density}' after a shorter window had more`
        );
        previous = current;
      }
    }
  }
});

test('keeps the Poco M5 stage full instead of banking slack below the controls', () => {
  const poco = DEVICES[0];
  const layout = layoutFor(poco, 1, true);
  // The old engine capped the artwork at 336dp on width and left the surplus
  // height as a gap above the badge row. The stage absorbs it now: the artwork
  // is either height-bound (meets the rail) or width-bound (centred in slack).
  assert.equal(layout.density, 'spacious');
  assert.equal(
    layout.artSizeScopeOn + layout.scopeBlockHeight + layout.stageInset * 2,
    layout.stageHeight,
    'the artwork should meet the rail and fill the inset stage, leaving no dead band'
  );
});

test('keeps the artwork clear of the header and the deck in both scope states', () => {
  for (const fontScale of FONT_SCALES) {
    for (const device of DEVICES) {
      for (const visualizer of [false, true]) {
        const layout = layoutFor(device, fontScale, visualizer);
        if (layout.density === 'compact' && layout.artSize < NOW_PLAYING_ART_COMFORT_MIN) {
          continue; // degenerate window: the artwork is already scraping the floor
        }
        // The artwork is centred, so its clearance is half of whatever the stage
        // has left over — and the rail, when shown, eats from the bottom half.
        const railSpace = visualizer && layout.scopeRailFits ? layout.scopeBlockHeight : 0;
        const clearance = (layout.stageHeight - layout.artSize - railSpace) / 2;
        assert.ok(
          clearance >= layout.stageInset,
          `${device.name} @${fontScale} scope=${visualizer}: only ${clearance}dp above the artwork, wanted ${layout.stageInset}`
        );
      }
    }
  }
});

test('holds the scope-off artwork to a shared cap across the phone lineup', () => {
  // An uncapped stage let tall phones blow the artwork up to near full width
  // (367dp on a Pixel 7 Pro). Every phone with the room now lands on the same
  // number; the smaller ones are honestly limited by their own stage.
  const capped: number[] = [];
  for (const device of DEVICES) {
    const layout = layoutFor(device, 1, false);
    if (layout.density !== 'spacious') continue;
    assert.ok(
      layout.artSize <= 320,
      `${device.name}: scope-off artwork ${layout.artSize} exceeded the tier cap`
    );
    // Devices whose stage could go bigger must be the ones sitting on the cap.
    if (layout.stageHeight - layout.stageInset * 2 > 320) capped.push(layout.artSize);
  }
  assert.ok(capped.length >= 4, 'expected several roomy phones in the lineup');
  assert.equal(
    new Set(capped).size,
    1,
    `roomy phones disagree on scope-off artwork: ${[...new Set(capped)].join(', ')}`
  );
});

test('keeps the band between the scope and the title tight', () => {
  // The reserved-but-usually-empty lyric row, the rail's bottom offset and the
  // gap to the title used to stack into ~96dp of void mid-screen.
  for (const device of DEVICES) {
    const layout = layoutFor(device, 1, true);
    if (!layout.scopeRailFits) continue;
    const band =
      layout.railBottomOffset + layout.deck.lyricRowHeight + layout.deck.lyricGap;
    assert.ok(
      band <= 60,
      `${device.name}: ${band}dp of dead space between the scope and the title`
    );
  }
});

test('binds the lyric row to the title rather than floating it', () => {
  for (const device of DEVICES) {
    const { deck } = layoutFor(device, 1, true);
    if (deck.lyricRowHeight === 0) {
      assert.equal(deck.lyricGap, 0, 'no lyric row means no gap for one');
      continue;
    }
    assert.ok(
      deck.lyricGap < deck.rowGap,
      `lyric gap ${deck.lyricGap} should be tighter than the deck rowGap ${deck.rowGap}`
    );
  }
});

test('caps reserved line boxes so a huge font setting cannot run away', () => {
  const device = DEVICES[0];
  const capped = layoutFor(device, 1.2, true);
  const beyond = layoutFor(device, 3, true);
  assert.equal(beyond.deck.height, capped.deck.height);
  assert.equal(beyond.deck.titleLineHeight, capped.deck.titleLineHeight);
  // ...but it does grow up to the cap.
  assert.ok(capped.deck.height > layoutFor(device, 1, true).deck.height);
});

test('adds the companion only to roomy tablet canvases', () => {
  for (const device of DEVICES) {
    assert.equal(getTabletCompanionLayout(device.width, device.height, true), null);
  }
  for (const [width, height] of [
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

test('clamps scope strip height to its band across widths', () => {
  assert.equal(getScopeHeight(0), 84);
  assert.equal(getScopeHeight(300), 84);
  assert.equal(getScopeHeight(448), 96);
  assert.equal(getScopeHeight(10000), 96);
  for (const device of DEVICES) {
    const { scopeWidth, scopeHeight } = layoutFor(device, 1, true);
    assert.equal(scopeHeight, getScopeHeight(scopeWidth));
  }
});

test('keeps calculated dimensions finite and non-negative', () => {
  const windows = [
    ...DEVICES.map((device) => [device.width, device.height] as const),
    ...WIDE_WINDOWS,
  ];
  for (const [width, height] of windows) {
    for (const visualizer of [false, true]) {
      for (const fontScale of FONT_SCALES) {
        const layout = getNowPlayingLayout(width, height, visualizer, false, fontScale);
        for (const [key, value] of Object.entries(layout)) {
          if (typeof value !== 'number') continue;
          assert.ok(Number.isFinite(value), `${key} is not finite at ${width}x${height}`);
          assert.ok(value >= 0, `${key} is negative at ${width}x${height}`);
        }
        for (const [key, value] of Object.entries(layout.deck)) {
          if (typeof value !== 'number') continue;
          assert.ok(Number.isFinite(value), `deck.${key} is not finite at ${width}x${height}`);
          assert.ok(value >= 0, `deck.${key} is negative at ${width}x${height}`);
        }
      }
    }
  }
});
