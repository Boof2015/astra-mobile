export type ArtistImageAutoPolicy = 'off' | 'wifi' | 'any';
export type ArtistGroupingMode = 'astra' | 'fileTags';

export interface DeezerArtistCandidate {
  provider: 'deezer';
  id: string;
  name: string;
  imageUrl: string;
  linkUrl: string | null;
  fanCount: number;
  albumCount: number;
}

export interface ArtistImageLookupTarget {
  groupingMode: ArtistGroupingMode;
  artistKey: string;
  artistName: string;
  retryCount?: number;
}

export interface PersistedArtistImageState {
  groupingMode: ArtistGroupingMode;
  artistKey: string;
  artistName?: string;
  manualImageHash: string | null;
  automaticImageHash: string | null;
  automaticProvider: 'deezer' | null;
  automaticSourceId: string | null;
  lookupStatus: 'never' | 'found' | 'not_found' | 'transient_error';
  retryCount: number;
  lastAttemptAt: number | null;
  nextRetryAt: number | null;
  updatedAt: number | null;
}

export type DeezerSearchResult =
  | { status: 'success'; candidates: DeezerArtistCandidate[] }
  | {
      status: 'transient_error';
      message: string;
      retryAfterMs: number;
      code:
        | 'offline'
        | 'timeout'
        | 'cancelled'
        | 'rate_limited'
        | 'provider'
        | 'invalid_response';
    };
