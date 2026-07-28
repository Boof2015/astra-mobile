import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseArtistCreditTransport,
  serializeArtistCreditTransport,
} from './artistCreditTransport.ts';

test('artist credits survive the string-only player transport', () => {
  const names = ['Earth, Wind & Fire', 'The Emotions'];
  assert.deepEqual(
    parseArtistCreditTransport(serializeArtistCreditTransport(names)),
    names
  );
});

test('artist credit transport rejects malformed or empty values', () => {
  assert.equal(parseArtistCreditTransport('{bad json'), undefined);
  assert.equal(parseArtistCreditTransport('[]'), undefined);
  assert.equal(serializeArtistCreditTransport([]), undefined);
});
