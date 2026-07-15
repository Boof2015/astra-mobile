import { SIGNAL_LINK_PREFIX } from './signalShare.ts';

// Match the scheme-less marker because Android/Expo can normalize opaque
// `astra:` URIs before redirectSystemPath receives them.
const SIGNAL_MARKER = SIGNAL_LINK_PREFIX.replace(/^astra:/, '');

/** Return the import route for an Astra Signal v3 deep link, or null. */
export function getSignalShareRedirectPath(path: string): string | null {
  let candidate = path.trim();
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    // Malformed percent-encoding cannot be a valid frame, but matching the raw
    // string keeps this router helper side-effect free.
  }
  const idx = candidate.indexOf(SIGNAL_MARKER);
  if (idx === -1) return null;
  const payload = candidate.slice(idx + SIGNAL_MARKER.length).match(/^[A-Za-z0-9_-]+/)?.[0];
  if (!payload) return null;
  return `/signal/import?data=${payload}`;
}
