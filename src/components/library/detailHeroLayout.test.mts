import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DETAIL_BAR_H,
  getDetailExpandedHeight,
  getDetailHeroLayout,
  getDetailMinContentHeight,
} from './detailHeroLayout.ts';

const WINDOWS = [
  { name: 'Pixel 7 Pro', portrait: [411, 891, 40], landscape: [891, 411, 24] },
  { name: 'Galaxy S22', portrait: [360, 780, 40], landscape: [780, 360, 24] },
  { name: 'Poco M5', portrait: [393, 873, 40], landscape: [873, 393, 24] },
  { name: 'Tablet 10"', portrait: [768, 1024, 24], landscape: [1024, 768, 24] },
  { name: 'small phone', portrait: [320, 568, 24], landscape: [568, 320, 24] },
] as const;

/** Roughly what the title + meta + buttons block measures. */
const BLOCK_HEIGHTS = [110, 154, 200, 260] as const;

test('the header always leaves the list a reachable strip', () => {
  // The bug this module exists for: a hero taller than its window pushes row 1
  // off the bottom AND covers the viewport, so no drag ever reaches the
  // scroller. The page could not be scrolled at all from the top.
  for (const entry of WINDOWS) {
    for (const [width, height, inset] of [entry.portrait, entry.landscape]) {
      const layout = getDetailHeroLayout(width, height, inset);
      for (const block of BLOCK_HEIGHTS) {
        const expanded = getDetailExpandedHeight(layout, block);
        const headerTotal = inset + expanded;
        assert.ok(
          headerTotal < height,
          `${entry.name} ${width}x${height} block ${block}: header ${headerTotal} >= window ${height}`
        );
        assert.ok(
          height - headerTotal >= 80,
          `${entry.name} ${width}x${height} block ${block}: only ${height - headerTotal}dp of list left`
        );
      }
    }
  }
});

test('landscape puts the block beside the artwork, portrait below it', () => {
  for (const entry of WINDOWS) {
    const [pw, ph, pi] = entry.portrait;
    const portrait = getDetailHeroLayout(pw, ph, pi);
    assert.equal(portrait.wide, false);
    assert.ok(
      portrait.blockTop >= portrait.artTop + portrait.artSize,
      `${entry.name} portrait: block should start below the artwork`
    );
    assert.equal(portrait.blockAlign, 'center');

    const [lw, lh, li] = entry.landscape;
    const landscape = getDetailHeroLayout(lw, lh, li);
    assert.equal(landscape.wide, true);
    assert.equal(
      landscape.blockTop,
      landscape.artTop,
      `${entry.name} landscape: block should start level with the artwork`
    );
    assert.ok(
      landscape.blockLeft >= landscape.artLeft + landscape.artSize,
      `${entry.name} landscape: block overlaps the artwork`
    );
    assert.ok(
      landscape.blockLeft < lw - landscape.blockRight,
      `${entry.name} landscape: block has no width left`
    );
    assert.equal(landscape.blockAlign, 'flex-start');
  }
});

test('landscape costs far less height than the portrait column did', () => {
  const [lw, lh, li] = WINDOWS[0].landscape;
  const landscape = getDetailHeroLayout(lw, lh, li);
  const expanded = getDetailExpandedHeight(landscape, 154);
  // The portrait column came to ~448dp on a 411dp-tall window.
  assert.ok(
    expanded < 260,
    `landscape hero is still ${expanded}dp tall`
  );
  assert.ok(lh - (li + expanded) > 140, 'landscape should leave a usable list');
});

test('the artwork centre matches where it is actually drawn', () => {
  // The collapse tween flies the artwork to the bar thumbnail using artCenterX;
  // portrait centres it, landscape does not, and a stale assumption would send
  // it to the wrong place.
  for (const entry of WINDOWS) {
    for (const [width, height, inset] of [entry.portrait, entry.landscape]) {
      const layout = getDetailHeroLayout(width, height, inset);
      assert.equal(
        layout.artCenterX,
        layout.artLeft + Math.round(layout.artSize / 2),
        `${entry.name} ${width}x${height}: artCenterX disagrees with artLeft + artSize/2`
      );
      assert.ok(layout.artLeft >= 0);
      assert.ok(layout.artLeft + layout.artSize <= width);
    }
  }
});

test('a taller block never shrinks the header', () => {
  for (const entry of WINDOWS) {
    for (const [width, height, inset] of [entry.portrait, entry.landscape]) {
      const layout = getDetailHeroLayout(width, height, inset);
      let previous = 0;
      for (let block = 80; block <= 400; block += 10) {
        const expanded = getDetailExpandedHeight(layout, block);
        assert.ok(
          expanded >= previous,
          `${entry.name} ${width}x${height}: header shrank from ${previous} to ${expanded}`
        );
        assert.ok(expanded >= DETAIL_BAR_H, 'header must clear the collapsed bar');
        previous = expanded;
      }
    }
  }
});

test('the fallback height is a sane stand-in before the block is measured', () => {
  for (const entry of WINDOWS) {
    for (const [width, height, inset] of [entry.portrait, entry.landscape]) {
      const layout = getDetailHeroLayout(width, height, inset);
      assert.ok(layout.fallbackExpandedHeight > DETAIL_BAR_H);
      assert.ok(
        inset + Math.min(layout.fallbackExpandedHeight, layout.maxExpandedHeight) <
          height,
        `${entry.name} ${width}x${height}: fallback header overflows the window`
      );
    }
  }
});

test('only naturally scrollable detail lists need to reach the compact header', () => {
  for (const entry of WINDOWS) {
    for (const [width, height, inset] of [entry.portrait, entry.landscape]) {
      const hero = getDetailHeroLayout(width, height, inset);
      // The phone tab bar occupies layout space; its floating mini-player
      // requires bottom padding. A landscape rail occupies neither.
      const viewport = height - (hero.wide ? 0 : 80);
      const bottomPadding = hero.wide ? 0 : 76;
      for (const blockHeight of BLOCK_HEIGHTS) {
        const expanded = getDetailExpandedHeight(hero, blockHeight);
        const firstRowTop = inset + expanded;
        for (const rowsHeight of [0, 72, 3 * 72, 7 * 76, 30 * 72, 180 + 320]) {
          const naturalHeight = firstRowTop + rowsHeight + bottomPadding;
          const minHeight = getDetailMinContentHeight(viewport, expanded, naturalHeight);
          const contentHeight = Math.max(naturalHeight, minHeight);
          const endOffset = Math.max(0, contentHeight - viewport);
          if (naturalHeight <= viewport) {
            assert.equal(minHeight, 0, 'a page that fits must not gain artificial scrolling');
            assert.equal(endOffset, 0);
            continue;
          }
          assert.ok(
            firstRowTop - endOffset <= inset + DETAIL_BAR_H,
            `${entry.name} ${width}x${height}, ${rowsHeight}dp of rows: header stops partway`
          );
          // Once the natural list can fully collapse, it needs no extra space.
          if (naturalHeight - viewport >= expanded - DETAIL_BAR_H) {
            assert.equal(contentHeight, naturalHeight);
          }
          // The last row still clears the floating mini-player at the end.
          assert.ok(firstRowTop + rowsHeight - endOffset <= viewport - bottomPadding);
        }
      }
    }
  }
});

test('the seven-track regression gains only the missing scroll distance', () => {
  const viewport = 811;
  const expanded = getDetailExpandedHeight(getDetailHeroLayout(411, 891, 40), 154);
  const naturalHeight = 40 + expanded + 7 * 76 + 76;
  // Previously stopped after 273dp, before the artwork settled at 352dp.
  assert.equal(naturalHeight - viewport, 273);
  const contentHeight = Math.max(naturalHeight, getDetailMinContentHeight(viewport, expanded, naturalHeight));
  assert.equal(contentHeight - naturalHeight, 115);
  assert.equal(contentHeight - viewport, 388);
});

test('pages that fit, including empty and one-track releases, keep their natural height', () => {
  const topPadding = 40 + 436;
  for (const rowsHeight of [0, 72, 3 * 72]) {
    assert.equal(getDetailMinContentHeight(811, 436, topPadding + rowsHeight + 76), 0);
  }
  assert.equal(getDetailMinContentHeight(811, 436, 811), 0); // Exactly fits.
  assert.equal(getDetailMinContentHeight(811, 436, 812), 1199); // Begins partial collapse.
  assert.equal(getDetailMinContentHeight(811, 436, 1199), 0); // Already reaches full collapse.
});

test('viewport, header and content changes can enable and remove the scroll floor', () => {
  assert.equal(getDetailMinContentHeight(0, 436, 1084), 0);
  assert.equal(getDetailMinContentHeight(811, 436, null), 0); // Not measured yet.
  assert.equal(getDetailMinContentHeight(811, 436, 1084), 1199);
  assert.equal(getDetailMinContentHeight(811, 500, 1148), 1263); // Wrapped title / larger text.
  assert.equal(getDetailMinContentHeight(411, 220, 500), 583); // Rotation into the rail layout.
  assert.equal(getDetailMinContentHeight(411.25, 220.5, 500), 584); // Never round the reach short.
  assert.equal(getDetailMinContentHeight(1100, 436, 1084), 0); // Larger viewport now fits.
  // Content grows, then shrinks while the previous minimum was active. Always
  // use natural content height so the extra space cannot sustain itself.
  assert.deepEqual(
    [624, 1084, 1600, 1084, 624].map((naturalHeight) =>
      getDetailMinContentHeight(811, 436, naturalHeight)
    ),
    [0, 1199, 0, 1199, 0]
  );
});
