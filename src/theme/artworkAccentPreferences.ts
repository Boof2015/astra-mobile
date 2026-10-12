export type CoverArtAccentMethod = 'adaptive' | 'dominant' | 'vibrant' | 'average';
export type NowPlayingAccentSource = 'app' | 'cover-art';

/** Only an unset preference uses the device default; explicit choices survive. */
export function parseNowPlayingAccentSource(value: string | null, isTV: boolean): NowPlayingAccentSource {
  return value === 'app' || value === 'cover-art' ? value : isTV ? 'cover-art' : 'app';
}

export const DEFAULT_COVER_ART_ACCENT_METHOD: CoverArtAccentMethod = 'adaptive';

export function parseCoverArtAccentMethod(value: string | null): CoverArtAccentMethod {
  switch (value) {
    case 'adaptive':
    case 'dominant':
    case 'vibrant':
    case 'average':
      return value;
    default:
      return DEFAULT_COVER_ART_ACCENT_METHOD;
  }
}
