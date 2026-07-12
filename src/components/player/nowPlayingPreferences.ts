export type NowPlayingCompanion = 'queue' | 'lyrics';

export function parseNowPlayingCompanion(value: string | null): NowPlayingCompanion {
  return value === 'lyrics' ? 'lyrics' : 'queue';
}
