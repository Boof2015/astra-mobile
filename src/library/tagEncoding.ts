// Repairs mojibake produced by MediaMetadataRetriever mis-decoding legacy ID3v2
// text frames — the classic case being Japanese MP3s with Shift-JIS bytes in an
// ISO-8859-1-flagged frame. MMR decodes each raw byte to a Latin-1 char, so the
// original bytes survive in the low byte of every code unit and can be recovered
// and re-decoded here. Desktop avoids this entirely via music-metadata, which
// honours the frame's encoding byte.

import * as Encoding from 'encoding-japanese';

// Characters that prove a recovered string is real Japanese/CJK text (kana, CJK
// unified ideographs, hangul, full/half-width forms). Used as the final gate so a
// mis-detection of accented Latin-1 (e.g. "Beyoncé") can never corrupt good text.
const CJK = /[\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/;

/**
 * Returns `value` re-decoded from a Japanese multibyte encoding when it is
 * recoverable mojibake; otherwise returns `value` unchanged. Safe to call on any
 * tag string — it is a no-op for ASCII, accented Latin, and already-correct
 * Unicode.
 */
export function repairMojibakeTag(value: string): string {
  let hasHighByte = false;
  const bytes = new Array<number>(value.length);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    // A code unit above 0xFF means the string already holds real Unicode (e.g.
    // MMR decoded a UTF-16 frame correctly) — there is nothing to recover.
    if (code > 0xff) return value;
    if (code >= 0x80) hasHighByte = true;
    bytes[i] = code;
  }
  if (!hasHighByte) return value; // pure ASCII/Latin — nothing to recover

  const detected = Encoding.detect(bytes);
  if (detected !== 'SJIS' && detected !== 'EUCJP') return value;

  const repaired = Encoding.convert(bytes, { to: 'UNICODE', from: detected, type: 'string' });
  // Only accept the conversion when it actually produced CJK text.
  return CJK.test(repaired) ? repaired : value;
}
