export type ListeningStatsRange = '7d' | '30d' | '1y' | 'all';
export type ListeningStatsRankingMetric = 'plays' | 'time';
export type ListeningStatsGranularity = 'day' | 'week' | 'month';
export type ListeningStatsCategory = 'tracks' | 'artists' | 'albums';

export interface ListeningHistoryStatus {
  generation: string;
  startedAt: number | null;
  enabled: boolean;
}

export interface ListeningSessionCheckpoint {
  generation: string;
  sessionKey: string;
  segmentKey: string;
  trackPath: string;
  sessionStartedAt: number;
  segmentStartedAt: number;
  observedAt: number;
  sessionListenedSeconds: number;
  segmentListenedSeconds: number;
  trackDurationSeconds: number;
  finalizeSegment: boolean;
  finalizeSession: boolean;
  completedNaturally: boolean;
  qualificationEligible: boolean;
}

export interface ListeningCheckpointResult {
  accepted: boolean;
  qualifiedNow: boolean;
  status: ListeningHistoryStatus;
}

export interface ListeningStatsSummary {
  listenedSeconds: number;
  qualifiedPlays: number;
  tracksPlayed: number;
  activeDays: number;
}

export interface ListeningStatsActivityBucket {
  startAt: number;
  endAt: number;
  label: string;
  listenedSeconds: number;
  qualifiedPlays: number;
}

interface RankedListeningRecord {
  key: string;
  artworkHash: string | null;
  sourceType: 'local' | 'subsonic' | 'jellyfin';
  sourceId: number | null;
  artworkSourceId: string | null;
  listenedSeconds: number;
  qualifiedPlays: number;
  available: boolean;
}

export interface RankedListeningTrack extends RankedListeningRecord {
  trackPath: string | null;
  title: string;
  artist: string;
  album: string;
}

export interface RankedListeningArtist extends RankedListeningRecord {
  artist: string;
}

export interface RankedListeningAlbum extends RankedListeningRecord {
  album: string;
  artist: string;
}

export interface ListeningStatsDashboard {
  status: ListeningHistoryStatus;
  range: ListeningStatsRange;
  rankingMetric: ListeningStatsRankingMetric;
  rangeStartAt: number | null;
  rangeEndAt: number;
  granularity: ListeningStatsGranularity;
  summary: ListeningStatsSummary;
  activity: ListeningStatsActivityBucket[];
  topTracks: RankedListeningTrack[];
  topArtists: RankedListeningArtist[];
  topAlbums: RankedListeningAlbum[];
}

export interface ListeningStatsDashboardQuery {
  range: ListeningStatsRange;
  rankingMetric: ListeningStatsRankingMetric;
  artistGroupingMode: 'astra' | 'fileTags';
  now?: number;
}
