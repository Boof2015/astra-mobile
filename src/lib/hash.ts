// Hashing for remote-source auth. RN/Hermes has no Node `crypto`, so the desktop
// `createHash('md5'|'sha1')` / `randomBytes` are swapped for tiny pure-JS hashers.

import { md5 } from 'js-md5';
import { sha1 } from 'js-sha1';

export function md5Hex(input: string): string {
  return md5(input);
}

export function sha1Hex(input: string): string {
  return sha1(input);
}

/**
 * Random hex salt (default 6 bytes), ported from desktop `randomBytes(6).toString('hex')`.
 * The Subsonic salt only needs to be unpredictable, not cryptographically strong, so
 * Math.random is sufficient and avoids an async crypto round-trip.
 */
export function randomSaltHex(bytes = 6): string {
  let out = '';
  for (let i = 0; i < bytes; i += 1) {
    out += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0');
  }
  return out;
}
