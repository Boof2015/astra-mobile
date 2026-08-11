import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findFuzzyMatch,
  multiFieldScore,
  type FuzzyMatch,
  type FuzzyMatchKind,
} from './fuzzySearch.ts';

function requireMatch(
  query: string,
  candidate: string,
  kind: FuzzyMatchKind
): FuzzyMatch {
  const match = findFuzzyMatch(query, candidate);
  if (!match) assert.fail(`Expected ${JSON.stringify(query)} to match ${JSON.stringify(candidate)}`);
  assert.equal(match.kind, kind);
  return match;
}

test('classifies every accepted match shape in relevance order', () => {
  const exact = requireMatch('Radiohead', 'Radiohead', 'exact');
  const prefix = requireMatch('Radio', 'Radiohead', 'prefix');
  const wordPrefix = requireMatch('Radio', 'The Radio Dept.', 'word-prefix');
  const substring = requireMatch('radio', 'Piradio Signal', 'substring');
  const initialism = requireMatch('rhc', 'Red Hot Chili Peppers', 'initialism');
  const compact = requireMatch('rdio', 'Radiohead', 'compact');

  assert.ok(exact.score > prefix.score);
  assert.ok(prefix.score > wordPrefix.score);
  assert.ok(wordPrefix.score > substring.score);
  assert.ok(substring.score > initialism.score);
  assert.ok(initialism.score > compact.score);
});

test('keeps short queries strict while accepting consecutive initials', () => {
  assert.equal(findFuzzyMatch('rd', 'Radiohead'), null);
  assert.equal(findFuzzyMatch('io', 'Radiohead'), null);
  requireMatch('ra', 'Radiohead', 'prefix');
  requireMatch('de', 'The Department', 'word-prefix');
  requireMatch('rh', 'Red Hot Chili Peppers', 'initialism');
  assert.equal(findFuzzyMatch('rhc', 'Red Hot Spicy Chili Peppers'), null);
});

test('bounds compact matches and rejects scattered, typo, incomplete, and multiword matches', () => {
  requireMatch('rdio', 'Radiohead', 'compact');
  assert.equal(findFuzzyMatch('rdio', 'Raaaaaaaadio'), null);
  assert.equal(findFuzzyMatch('rhd', 'Radiohead'), null);
  assert.equal(findFuzzyMatch('the', 'Everything in Its Right Place'), null);
  assert.equal(findFuzzyMatch('kid', 'Knights of Cydonia'), null);
  assert.equal(findFuzzyMatch('love', 'Long Drive Home'), null);
  assert.equal(findFuzzyMatch('raido', 'Radiohead'), null);
  assert.equal(findFuzzyMatch('radioz', 'Radiohead'), null);
  assert.equal(findFuzzyMatch('r d', 'Radiohead'), null);
});

test('normalizes case and repeated whitespace without broadening eligibility', () => {
  requireMatch('  RADIO   DEPT  ', 'Radio Dept', 'exact');
  assert.equal(findFuzzyMatch('', 'Radiohead'), null);
  assert.equal(findFuzzyMatch('radio', ''), null);
});

test('ranks match class before field weight and uses the strongest eligible field', () => {
  const exactLowWeight = multiFieldScore('radio', [
    { value: 'Radio', weight: 0.1 },
  ]);
  const prefixHighWeight = multiFieldScore('radio', [
    { value: 'Radiohead', weight: 9 },
  ]);

  assert.notEqual(exactLowWeight, null);
  assert.notEqual(prefixHighWeight, null);
  assert.ok((exactLowWeight ?? 0) > (prefixHighWeight ?? 0));

  const strongestField = multiFieldScore('radio', [
    { value: 'The Radio Dept.', weight: 2 },
    { value: 'Radiohead', weight: 1 },
  ]);
  assert.equal(strongestField, multiFieldScore('radio', [
    { value: 'Radiohead', weight: 1 },
  ]));
});

test('handles nullable fields and does not let weights revive rejected fields', () => {
  assert.equal(multiFieldScore('radio', [
    { value: null, weight: 999 },
    { value: undefined, weight: 999 },
    { value: 'Radio', weight: 1 },
  ]), multiFieldScore('radio', [{ value: 'Radio', weight: 1 }]));

  assert.equal(multiFieldScore('kid', [
    { value: 'Knights of Cydonia', weight: 999 },
  ]), null);
});

test('prefers compact, early, shorter candidates within a match class', () => {
  const compact = requireMatch('rdio', 'Radiohead', 'compact').score;
  const spread = requireMatch('rdio', 'Raxdiohead', 'compact').score;
  const earlier = requireMatch('radio', 'The Radio Dept.', 'word-prefix').score;
  const later = requireMatch('radio', 'Music by Radio Dept.', 'word-prefix').score;
  const shorter = requireMatch('radio', 'Radiohead', 'prefix').score;
  const longer = requireMatch('radio', 'Radiotelegraph', 'prefix').score;

  assert.ok(compact > spread);
  assert.ok(earlier > later);
  assert.ok(shorter > longer);
  assert.equal(
    multiFieldScore('radio', [{ value: 'Radiohead', weight: 1 }]),
    multiFieldScore('radio', [{ value: 'Radiohead', weight: 1 }])
  );
});

test('returns exact original indices for literal, initialism, and compact highlights', () => {
  assert.deepEqual(requireMatch('radio', 'The Radio Dept.', 'word-prefix').indices, [4, 5, 6, 7, 8]);
  assert.deepEqual(requireMatch('rhc', 'Red Hot Chili Peppers', 'initialism').indices, [0, 4, 8]);
  assert.deepEqual(requireMatch('rdio', 'Radiohead', 'compact').indices, [0, 2, 3, 4]);
});

test('returns no indices for rejected or incomplete highlight queries', () => {
  assert.equal(findFuzzyMatch('rhd', 'Radiohead'), null);
  assert.equal(findFuzzyMatch('radioz', 'Radiohead'), null);
  assert.equal(findFuzzyMatch('radio', 'Kid A'), null);
});
