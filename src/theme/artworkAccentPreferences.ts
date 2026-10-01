export type CoverArtAccentMethod = 'adaptive' | 'dominant' | 'vibrant' | 'average';

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
