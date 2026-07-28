import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LISTENING_STATS_SHARE_HEIGHT,
  LISTENING_STATS_SHARE_WIDTH,
} from './shareDimensions.ts';
import {
  buildListeningStatsShareModel,
  formatCompactListeningDuration,
  formatListeningShare,
} from './shareModel.ts';
import type { ListeningStatsDashboard } from '../types/listeningStats.ts';

function dashboard(): ListeningStatsDashboard {
  return {
    status: { generation: 'generation', startedAt: 1_700_000_000_000, enabled: true },
    range: '30d',
    rankingMetric: 'plays',
    rangeStartAt: 1_700_000_000_000,
    rangeEndAt: 1_702_000_000_000,
    granularity: 'day',
    summary: {
      listenedSeconds: 7_200,
      qualifiedPlays: 12,
      tracksPlayed: 4,
      activeDays: 3,
    },
    activity: [],
    topTracks: [{
      key: 'track:/private/path.flac',
      trackPath: '/private/path.flac',
      title: 'Top Track',
      artist: 'Artist',
      album: 'Album',
      artworkHash: null,
      sourceType: 'local',
      sourceId: null,
      artworkSourceId: null,
      listenedSeconds: 3_600,
      qualifiedPlays: 7,
      available: true,
    }],
    topArtists: [{
      key: 'artist',
      artist: 'Artist',
      artworkHash: null,
      sourceType: 'local',
      sourceId: null,
      artworkSourceId: null,
      listenedSeconds: 4_000,
      qualifiedPlays: 8,
      available: true,
    }],
    topAlbums: [{
      key: 'album-key',
      album: 'Album',
      artist: 'Artist',
      artworkHash: null,
      sourceType: 'local',
      sourceId: null,
      artworkSourceId: null,
      listenedSeconds: 3_900,
      qualifiedPlays: 8,
      available: true,
    }],
  };
}

test('share model carries range and ranking context without private paths', () => {
  const model = buildListeningStatsShareModel(dashboard(), 'track');
  assert.equal(model.title, 'YOUR TOP TRACK');
  assert.equal(model.rankingLabel, 'RANKED BY PLAYS');
  assert.match(model.suggestedFileName, /^astra-listening-30d-plays-\d{4}-\d{2}-\d{2}\.png$/);
  assert.equal(JSON.stringify(model).includes('/private/path.flac'), false);
});

test('overview and album lenses use matching ranked data', () => {
  assert.deepEqual(
    buildListeningStatsShareModel(dashboard(), 'overview').overviewItems.map((item) => item.kind),
    ['track', 'album', 'artist'],
  );
  assert.equal(buildListeningStatsShareModel(dashboard(), 'album').hero?.title, 'Album');
});

test('duration, percentages, and canonical PNG dimensions are stable', () => {
  assert.equal(formatCompactListeningDuration(7_200), '2h');
  assert.equal(formatListeningShare(3_600, 7_200), '50%');
  assert.equal(LISTENING_STATS_SHARE_WIDTH, 1474);
  assert.equal(LISTENING_STATS_SHARE_HEIGHT, 1920);
});
