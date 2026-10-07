import assert from 'node:assert/strict';
import test from 'node:test';
import { highlightedName, parseSearchHistory, rememberSearch, searchSuggestions } from './searchModel.ts';

test('autocomplete favors name prefixes, then word prefixes, with one typed identity per name', () => {
  assert.deepEqual(searchSuggestions('night', [
    { name: 'Late nights', kind: 'Playlist' }, { name: 'NIGHT', kind: 'Track' },
    { name: 'Night', kind: 'Artist' }, { name: 'Midnight', kind: 'Album' },
    { name: 'Nightfall', kind: 'Album' },
  ], 6).map(({ name, kind }) => ({ name, kind })), [
    { name: 'Night', kind: 'Artist' }, { name: 'Nightfall', kind: 'Album' }, { name: 'Late nights', kind: 'Playlist' },
  ]);
});
test('the typing and closed-keyboard limits keep suggestions bounded', () => {
  const names = Array.from({ length: 30 }, (_, i) => ({ name: `Night ${i}`, kind: 'Track' as const }));
  assert.equal(searchSuggestions('ni', names, 4).length, 4);
  assert.equal(searchSuggestions('ni', names, 6).length, 6);
  assert.deepEqual(searchSuggestions('   ', names, 6), []);
});
test('highlighting uses original UTF-16 positions without splitting emoji', () => {
  const [match] = searchSuggestions('night', [{ name: '🌙 Night', kind: 'Album' }], 6);
  assert.deepEqual(highlightedName(match.name, match.indices), [{ text: '🌙 ', strong: false }, { text: 'Night', strong: true }]);
});
test('recent queries retain five entries, promote repeats and reject malformed saved data', () => {
  const old = ['one', 'two', 'three', 'four', 'five'];
  assert.deepEqual(rememberSearch(old, ' TWO '), ['TWO', 'one', 'three', 'four', 'five']);
  assert.deepEqual(rememberSearch(old, 'six'), ['six', 'one', 'two', 'three', 'four']);
  assert.deepEqual(rememberSearch(old, ' '), old);
  assert.deepEqual(parseSearchHistory('{broken'), []);
  assert.deepEqual(parseSearchHistory('{"not":"a list"}'), []);
  assert.deepEqual(parseSearchHistory('["new",42,"NEW","old",null]'), ['new', 'old']);
  const longName = 'A full album name '.repeat(8).trim();
  assert.equal(parseSearchHistory(JSON.stringify(rememberSearch([], longName)))[0], longName);
});
