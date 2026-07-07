import { EQ_PRESET_QR_PREFIX } from './eqShare';

// The QR marker without the `astra:` scheme, e.g. 'eq-preset:v1:'. The scheme is
// stripped/normalized inconsistently by the OS before it reaches redirectSystemPath,
// so we match on the scheme-less marker instead of the full prefix.
const EQ_PRESET_MARKER = EQ_PRESET_QR_PREFIX.replace(/^astra:/, '');

/**
 * Returns a router path for an EQ-preset-share deep link (`astra:eq-preset:v1:<payload>`
 * scanned by the native camera), or null if `path` is not one.
 *
 * The exact shape handed to redirectSystemPath for an opaque `astra:...` URI varies across
 * OS/expo versions (`astra:`, `astra://`, bare, slash-prefixed, and colons possibly
 * percent-encoded), so we decode once, locate the marker, and pull the trailing base64url
 * run. That alphabet (`[A-Za-z0-9_-]`) is query-safe, so no re-encoding is needed.
 */
export function getEQPresetShareRedirectPath(path: string): string | null {
  let candidate = path.trim();
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    // Malformed percent-encoding — fall back to the raw string.
  }
  const idx = candidate.indexOf(EQ_PRESET_MARKER);
  if (idx === -1) return null;
  const payload = candidate.slice(idx + EQ_PRESET_MARKER.length).match(/^[A-Za-z0-9_-]+/)?.[0];
  if (!payload) return null;
  return `/eq/import?data=${payload}`;
}
