import assert from 'node:assert/strict';
import test from 'node:test';
import { getOnboardingLayout, onboardingTextScale } from './onboardingLayout.ts';

const phoneInsets = { top: 24, bottom: 24, left: 0, right: 0 };

test('a portrait phone stacks; the title block is a sum of declared line boxes', () => {
  const layout = getOnboardingLayout(411, 818, phoneInsets, 1, false);
  assert.equal(layout.presentation, 'stack');
  // 12 + 16 + 8 + 41*2 + 8 + 20*3 + 16
  assert.equal(layout.titleBlockHeight, 202);
  assert.equal(layout.footerHeight, 80);
  assert.equal(layout.contentColumnWidth, 411);
});

test('the title block grows with font scale up to the cap and no further', () => {
  const at12 = getOnboardingLayout(411, 818, phoneInsets, 1.2, false);
  const at20 = getOnboardingLayout(411, 818, phoneInsets, 2, false);
  assert.ok(at12.titleBlockHeight > 202);
  assert.equal(at20.titleBlockHeight, at12.titleBlockHeight);
  assert.equal(onboardingTextScale(0.85), 1);
});

test('a short window (the shell rail) splits even when narrow', () => {
  assert.equal(getOnboardingLayout(891, 411, { top: 0, bottom: 0, left: 48, right: 0 }, 1, true).presentation, 'split');
});

test('tablet width splits by ratio, never a capped column', () => {
  const tablet = getOnboardingLayout(800, 1280, phoneInsets, 1, false);
  assert.equal(tablet.presentation, 'split');
  assert.equal(tablet.titleColumnWidth, 320);
  assert.equal(tablet.contentColumnWidth, 480);
  const wider = getOnboardingLayout(1280, 800, phoneInsets, 1, false);
  assert.ok(wider.contentColumnWidth > tablet.contentColumnWidth);
});

test('font scale never changes the presentation or the footer', () => {
  const a = getOnboardingLayout(411, 818, phoneInsets, 1, false);
  const b = getOnboardingLayout(411, 818, phoneInsets, 1.2, false);
  assert.equal(a.presentation, b.presentation);
  assert.equal(a.footerHeight, b.footerHeight);
});
