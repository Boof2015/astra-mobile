import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getNowPlayingLayout,
  getNowPlayingLyricsToggleLayout,
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

test('the shared lyrics toggle occupies the normal utility slot without measuring either body', () => {
  const windows = [...DEVICES, { name: 'landscape', width: 780, height: 360 },
    { name: 'short landscape', width: 720, height: 320 }];
  for (const device of windows) {
    for (const scale of FONT_SCALES) {
      for (const scope of [false, true]) {
        const layout = getNowPlayingLayout(device.width, device.height, scope, false, scale);
        const slot = getNowPlayingLyricsToggleLayout(layout, device.height);
        const shellHeight = device.height - NOW_PLAYING_CONTENT_TOP_PADDING - NOW_PLAYING_CONTENT_BOTTOM_PADDING;
        const bodyHeight = shellHeight - NOW_PLAYING_HEADER_HEIGHT;
        const deckTop = NOW_PLAYING_HEADER_HEIGHT + (layout.isWide
          ? (bodyHeight - layout.deck.height) / 2 : layout.stageHeight);
        const utilityCenter = deckTop + layout.deck.height - layout.deck.utilityRowHeight / 2;
        assert.equal(shellHeight - slot.bottom - slot.height / 2, utilityCenter,
          `${device.name} @${scale}: lyrics button must match the normal utility row`);
        assert.equal(slot.right, 8);
        assert.equal(slot.width, layout.deck.subButtonSize);
        assert.ok(slot.lyricsBottomClearance >= slot.bottom + slot.height);
      }
    }
  }
});

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

/**
 * Windows that must use the side-by-side row: too short to stack, whatever
 * their width. Tablets used to be in here because the branch was picked by
 * `isWideWindow` — see `STACKED_TABLETS`.
 */
const LANDSCAPE = [
  { name: 'Pixel 7 Pro landscape', width: 891, height: 339 },
  { name: 'S22 landscape', width: 780, height: 312 },
  { name: 'Poco M5 landscape', width: 873, height: 345 },
  { name: 'S25 Ultra landscape', width: 918, height: 363 },
  { name: 'very short landscape', width: 800, height: 300 },
] as const;

/**
 * Windows with the height to stack artwork over a deck. Side-by-side is the
 * phone-in-landscape compromise, not the big-screen layout, so none of these
 * may take it — including a tablet in landscape.
 */
const STACKED_TABLETS = [
  { name: 'Tablet 10" landscape', width: 1248, height: 752 },
  { name: 'Tablet 12" landscape', width: 1366, height: 1000 },
  { name: 'Tablet portrait', width: 768, height: 1150 },
  { name: 'Foldable open landscape', width: 800, height: 650 },
  { name: 'Foldable open portrait', width: 808, height: 868 },
  { name: 'Tablet 10" landscape, companion out', width: 856, height: 752 },
] as const;

test('a window with the height to stack never uses the side-by-side row', () => {
  for (const fontScale of FONT_SCALES) {
    for (const window of STACKED_TABLETS) {
      for (const scope of [false, true]) {
        // `forceWide` is the companion tier asking for the landscape row. Even
        // that must lose: the player cannot change shape because a pane slid in
        // beside it.
        for (const forceWide of [false, true]) {
          const layout = getNowPlayingLayout(
            window.width,
            window.height,
            scope,
            forceWide,
            fontScale
          );
          assert.equal(
            layout.presentation,
            'standard',
            `${window.name} (scope ${scope}, forceWide ${forceWide}) should stack`
          );
        }
      }
    }
  }
});

test('a stacked tablet gives the artwork the height a phone cannot', () => {
  for (const window of STACKED_TABLETS) {
    const layout = getNowPlayingLayout(window.width, window.height, false, false, 1);
    assert.ok(
      layout.artSizeScopeOff >= 320,
      `${window.name}: art ${layout.artSizeScopeOff} is a thumbnail on this screen`
    );
    // Height-bound, not ceiling-bound: the artwork is square, so it can only
    // ever spend height, and it must still clear the deck.
    assert.ok(
      layout.artSizeScopeOff <= layout.stageHeight,
      `${window.name}: art ${layout.artSizeScopeOff} overflows stage ${layout.stageHeight}`
    );
  }
});

test('a stacked tablet spends spare width on the deck, not on the artwork', () => {
  // The waveform is the only control that turns width into resolution. The
  // artwork is square and gains nothing, so a wider column must not inflate it.
  // Both windows are below the deck's ceiling so the deck is still growing.
  const wider = getNowPlayingLayout(700, 1000, false, false, 1);
  const narrower = getNowPlayingLayout(620, 1000, false, false, 1);
  assert.ok(wider.contentWidth > narrower.contentWidth);
  assert.equal(wider.artSizeScopeOff, narrower.artSizeScopeOff);
});

test('the deck stops widening well before it fills a tablet', () => {
  // Past about half a 10" tablet the extra width stops buying a better scrub
  // and starts stretching the rows around it — title hard left, favourite hard
  // right, void between. Same failure as a full-width `TrackRow`.
  for (const window of STACKED_TABLETS) {
    const layout = getNowPlayingLayout(window.width, window.height, false, false, 1);
    assert.ok(
      layout.contentWidth <= 640,
      `${window.name}: deck ${layout.contentWidth} exceeds the ceiling`
    );
    // A portrait tablet *should* fill its column — there is no surplus to
    // leave. The margin only has to appear where the window is genuinely wide.
    if (window.width < 1000) continue;
    assert.ok(
      layout.contentWidth <= window.width * 0.6,
      `${window.name}: deck ${layout.contentWidth} of ${window.width} is a stretched row`
    );
  }
  // And the ceiling actually binds on a tablet, rather than the window doing it.
  assert.equal(getNowPlayingLayout(1248, 752, false, false, 1).contentWidth, 640);
  assert.equal(getNowPlayingLayout(1366, 1000, false, false, 1).contentWidth, 640);
});

test('a phone is untouched by every tablet ceiling and floor', () => {
  const phones = [...LANDSCAPE, { name: 'Pixel 7 Pro portrait', width: 380, height: 850 }];
  for (const window of phones) {
    for (const scope of [false, true]) {
      const layout = getNowPlayingLayout(window.width, window.height, scope, false, 1);
      assert.ok(
        layout.artSize <= 400,
        `${window.name}: art ${layout.artSize} exceeds the phone ceiling`
      );
      assert.ok(
        layout.contentWidth <= 960,
        `${window.name}: row ${layout.contentWidth} exceeds the phone ceiling`
      );
    }
  }
});

test('landscape sizes its panes from their contents, not a fixed split', () => {
  for (const fontScale of FONT_SCALES) {
    for (const window of LANDSCAPE) {
      const layout = getNowPlayingLayout(
        window.width,
        window.height,
        true,
        false,
        fontScale
      );
      assert.equal(layout.presentation, 'wide', `${window.name} should be wide`);
      assert.equal(
        layout.leftPaneWidth + 32 + layout.rightPaneWidth,
        layout.contentWidth,
        `${window.name}: panes + gap must equal the row width`
      );
      assert.ok(
        layout.contentWidth <= window.width - layout.contentPadding * 2,
        `${window.name}: row ${layout.contentWidth} overflows the window`
      );
      // The stage pane exists to hold the artwork and its strip; a proportional
      // split used to hand a 160dp artwork a 432dp pane.
      assert.equal(
        layout.leftPaneWidth,
        Math.max(layout.artSizeScopeOff, layout.scopeWidth),
        `${window.name}: stage pane should hug its widest content`
      );
    }
  }
});

test('landscape actually uses the width it is given', () => {
  // The deck cap was aliased to the portrait column width, leaving 100-150dp of
  // a phone's landscape row unused. Height is scarce in landscape and the
  // artwork is square, so the deck is the only pane that can spend the surplus.
  for (const window of LANDSCAPE) {
    if (window.width > 1000) continue; // tablets are capped by design, for now
    const layout = getNowPlayingLayout(window.width, window.height, true, false, 1);
    const rowSpace = Math.min(window.width - layout.contentPadding * 2, 960);
    const unused = rowSpace - layout.contentWidth;
    assert.ok(
      unused <= 40,
      `${window.name}: ${unused}dp of the row goes unused (row ${layout.contentWidth} of ${rowSpace})`
    );
  }
});

test('landscape keeps the scope strip in proportion to the artwork', () => {
  for (const window of LANDSCAPE) {
    const layout = getNowPlayingLayout(window.width, window.height, true, false, 1);
    if (!layout.scopeRailFits) continue;
    assert.ok(
      layout.scopeWidth >= layout.artSizeScopeOn,
      `${window.name}: strip ${layout.scopeWidth} narrower than artwork ${layout.artSizeScopeOn}`
    );
    // Was 2.7x on a Pixel in landscape, which read as a box beside the art.
    assert.ok(
      layout.scopeWidth <= layout.artSizeScopeOn * 1.6 + 1,
      `${window.name}: strip ${layout.scopeWidth} is out of proportion to artwork ${layout.artSizeScopeOn}`
    );
    assert.equal(layout.scopeHeight, getScopeHeight(layout.scopeWidth));
  }
});

test('landscape picks the richest deck the column can hold', () => {
  const rank = { compact: 0, regular: 1, spacious: 2 } as const;
  for (const fontScale of FONT_SCALES) {
    for (const window of LANDSCAPE) {
      const layout = getNowPlayingLayout(
        window.width,
        window.height,
        true,
        false,
        fontScale
      );
      const column =
        window.height -
        NOW_PLAYING_CONTENT_TOP_PADDING -
        NOW_PLAYING_CONTENT_BOTTOM_PADDING -
        NOW_PLAYING_HEADER_HEIGHT;
      // Either the deck fits, or it is the leanest tier and the window is the
      // one at fault.
      assert.ok(
        layout.deck.height <= column || layout.density === 'compact',
        `${window.name} @${fontScale}: '${layout.density}' deck ${layout.deck.height} exceeds column ${column}`
      );
      assert.equal(layout.stageHeight, column);
      assert.ok(rank[layout.density] >= 0);
    }
  }
});

test('landscape never grows the artwork when the scope comes on', () => {
  for (const fontScale of FONT_SCALES) {
    for (const window of LANDSCAPE) {
      const hidden = getNowPlayingLayout(window.width, window.height, false, false, fontScale);
      const visible = getNowPlayingLayout(window.width, window.height, true, false, fontScale);
      assert.equal(hidden.deck.height, visible.deck.height);
      assert.equal(hidden.leftPaneWidth, visible.leftPaneWidth);
      assert.equal(hidden.rightPaneWidth, visible.rightPaneWidth);
      assert.equal(hidden.contentWidth, visible.contentWidth);
      assert.ok(visible.artSizeScopeOn <= visible.artSizeScopeOff);
    }
  }
});

test('gives lyrics the majority of the shell and the queue a sidecar share', () => {
  for (const [width, height] of [
    [1248, 752],
    [1366, 1000],
  ]) {
    const queue = getTabletCompanionLayout(width, height, false, 1, 'queue');
    const lyrics = getTabletCompanionLayout(width, height, false, 1, 'lyrics');
    assert.ok(queue && lyrics, `${width}x${height} should qualify`);
    // A queue row is a thumbnail and two short lines; a lyric line is a
    // sentence. Sizing both the same is what left lyrics wrapping mid-phrase.
    assert.ok(
      queue.companionWidth / queue.shellWidth <= 0.4,
      `queue took ${queue.companionWidth} of ${queue.shellWidth}`
    );
    assert.ok(
      lyrics.companionWidth / lyrics.shellWidth >= 0.55,
      `lyrics took only ${lyrics.companionWidth} of ${lyrics.shellWidth}`
    );
  }
});

test('never lets a companion starve the player, however wide it wants to be', () => {
  for (let width = 720; width <= 2000; width += 1) {
    for (const companion of ['queue', 'lyrics'] as const) {
      const layout = getTabletCompanionLayout(width, 900, false, 1, companion);
      if (!layout) continue;
      assert.ok(
        layout.playerRegionWidth >= 320,
        `${companion} at ${width} left the player ${layout.playerRegionWidth}`
      );
      assert.equal(
        layout.playerRegionWidth + layout.gap + layout.companionWidth,
        layout.shellWidth,
        `${companion} at ${width} does not account for the shell`
      );
    }
  }
});

test('a companion never changes the artwork it sits beside', () => {
  // The pane takes width from the deck, not from the cover: the artwork is
  // height-bound, so opening or widening a companion must not shrink it. This
  // is also what lets the pane animate in as a translate rather than a resize.
  const closed = getNowPlayingLayout(1248, 752, false, false, 1, true);
  for (const companion of ['queue', 'lyrics'] as const) {
    const open = getTabletCompanionLayout(1248, 752, false, 1, companion);
    assert.ok(open, `${companion} should qualify`);
    assert.equal(
      open.playerLayout.artSizeScopeOff,
      closed.artSizeScopeOff,
      `${companion} resized the artwork`
    );
  }
});

test('adds the companion only to roomy tablet canvases', () => {
  for (const device of DEVICES) {
    assert.equal(getTabletCompanionLayout(device.width, device.height, true), null);
  }
  for (const [width, height] of [
    [600, 840],
    [800, 600],
    // A 600dp-tall tablet cannot stack artwork over a deck, and the
    // side-by-side player it used to fall back to is the phone-in-landscape
    // compromise rather than a tablet layout. With nothing good to show beside
    // the player, it gets the full window instead of a companion.
    [1024, 600],
  ]) {
    assert.equal(getTabletCompanionLayout(width, height, true), null);
  }

  for (const [width, height] of [
    [768, 1024],
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
