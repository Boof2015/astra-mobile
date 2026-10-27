import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Outside the tabs navigator, `Screen` pays the bottom inset by default, so a
 * screen that forgets about the navigation bar still stops above it. Opting out
 * with `bleedBottom` hands that inset to the content instead, and that is the
 * one place it can still go missing: a screen that bleeds without re-paying
 * puts its last row back under an opaque 3-button bar, which is exactly how
 * every settings page shipped cut off on a Samsung tablet.
 *
 * So any file that passes `bleedBottom` must also ask `useSceneBottomInset` for
 * the amount, unless its only bottom content pays the inset on its own.
 */
const SRC = new URL('../', import.meta.url);

/** Files that bleed without re-paying, and what pays instead. */
const PAID_ELSEWHERE: Record<string, string> = {
  'app/eq/import.tsx': 'its only bottom content is an AppSheet, which pays the inset itself',
};

function sourceFiles(): string[] {
  return readdirSync(fileURLToPath(SRC), { recursive: true, encoding: 'utf8' })
    .filter((path) => /\.tsx?$/.test(path))
    .map((path) => path.split('\\').join('/'));
}

test('a screen that bleeds past the navigation bar re-pays the inset', () => {
  const bleeding = sourceFiles().filter(
    (path) =>
      path !== 'components/Screen.tsx' &&
      /\bbleedBottom\b/.test(readFileSync(new URL(path, SRC), 'utf8'))
  );
  // Guard the scan itself: an empty match would pass vacuously.
  assert.ok(bleeding.includes('components/settings/SettingsSectionScaffold.tsx'));

  for (const path of bleeding) {
    if (path in PAID_ELSEWHERE) continue;
    assert.match(
      readFileSync(new URL(path, SRC), 'utf8'),
      /\buseSceneBottomInset\(\)/,
      `${path} passes bleedBottom but never reads useSceneBottomInset, so its last row sits under the navigation bar`
    );
  }
});

test('the exemptions still bleed', () => {
  for (const path of Object.keys(PAID_ELSEWHERE)) {
    assert.match(
      readFileSync(new URL(path, SRC), 'utf8'),
      /\bbleedBottom\b/,
      `${path} no longer bleeds; drop it from PAID_ELSEWHERE`
    );
  }
});
