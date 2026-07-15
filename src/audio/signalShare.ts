import {
  SIGNAL_LINK_PREFIX,
  decodeSignalLink as decodeLibrarySignalLink,
  encodeSignal,
  encodeSignalLink as encodeLibrarySignalLink,
  type SignalInput,
  type SignalLayout,
  type SignalPayload,
} from '@boof2015/astra-signal';
import type { Track } from '../types/audio';

export { SIGNAL_LINK_PREFIX };

export const SIGNAL_WEB_URL = 'https://astramusic.dev/signal/';

/** Convert local track metadata into the database-free v3 Signal input. */
export function signalInputFromTrack(track: Track): SignalInput {
  return {
    artist: track.artist,
    title: track.title,
    durationSec: Number.isFinite(track.duration) ? Math.round(track.duration) : 0,
  };
}

/** Build the ECC-protected optical layout rendered by SignalCode. */
export function signalLayoutFromTrack(track: Track): SignalLayout {
  return encodeSignal(signalInputFromTrack(track));
}

/** Build the compact v3 link frame. Links carry CRC, but no visual padding or ECC. */
export function encodeTrackSignalLink(track: Track): string {
  return encodeLibrarySignalLink(signalInputFromTrack(track));
}

/** Build the privacy-preserving web resolver URL. The Signal stays in the fragment. */
export function encodeSignalWebUrl(input: SignalInput): string {
  return `${SIGNAL_WEB_URL}#${encodeLibrarySignalLink(input)}`;
}

export function decodeTrackSignalLink(value: string): SignalPayload {
  return decodeLibrarySignalLink(value);
}
