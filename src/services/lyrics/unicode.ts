// Hermes-safe Unicode helpers for the lyrics providers. Desktop uses
// String.prototype.normalize and `\p{…}` regex property escapes freely; RN's
// Hermes engine may lack full ICU normalization or property-escape support on a
// given build, and an unsupported `\p{…}` regex *literal* is a parse error that
// would break the whole bundle. So we (a) wrap normalize in try/catch and
// (b) build any property-escape regex with `new RegExp` inside try/catch,
// falling back to an explicit-range regex (built from \u escapes) when the
// engine rejects it.

export function safeNormalize(value: string, form: 'NFC' | 'NFD' | 'NFKC' | 'NFKD'): string {
  try {
    return value.normalize(form);
  } catch {
    return value;
  }
}

function makeUnicodeRegex(pattern: string, flags: string, fallbackPattern: string): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch {
    // The property-escape form was rejected; the fallback uses only \u ranges.
    return new RegExp(fallbackPattern, flags.replace('u', ''));
  }
}

// Combining marks (\p{M}). Fallback covers the common combining-mark blocks.
export const COMBINING_MARKS_RE = makeUnicodeRegex(
  '\\p{M}+',
  'gu',
  '[\\u0300-\\u036f\\u1ab0-\\u1aff\\u1dc0-\\u1dff\\u20d0-\\u20ff\\ufe20-\\ufe2f]+'
);

// Anything that is NOT a letter or number ([^\p{L}\p{N}]). Fallback keeps ASCII
// alphanumerics plus the common Latin/Greek/Cyrillic/CJK/Kana/Hangul ranges and
// collapses the rest (punctuation, symbols, whitespace) to a single space.
export const NON_ALNUM_RE = makeUnicodeRegex(
  '[^\\p{L}\\p{N}]+',
  'gu',
  '[^0-9A-Za-z\\u00c0-\\u024f\\u0370-\\u03ff\\u0400-\\u04ff\\u3040-\\u30ff\\u3400-\\u9fff\\uac00-\\ud7af\\uff00-\\uffef]+'
);

// Control characters (\p{Cc}). Fallback covers C0 + DEL + C1.
export const CONTROL_CHARS_RE = makeUnicodeRegex(
  '\\p{Cc}+',
  'gu',
  '[\\u0000-\\u001f\\u007f-\\u009f]+'
);
