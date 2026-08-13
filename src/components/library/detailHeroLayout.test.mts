import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DETAIL_BAR_H,
  getDetailExpandedHeight,
  getDetailHeroLayout,
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
