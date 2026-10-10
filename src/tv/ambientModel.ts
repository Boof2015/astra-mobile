import type { Album } from '../types/library.ts';

export const AMBIENT_DELAYS = [0, 1, 2, 5] as const;
export type AmbientDelay = typeof AMBIENT_DELAYS[number];
export const AMBIENT_MOMENT_MS = 40_000;
export const ambientDelayLabel = (value: AmbientDelay) => value ? `After ${value} min` : 'Off';
export const parseAmbientDelay = (value: string | null): AmbientDelay => value === '0' ? 0 : value === '1' ? 1 : value === '5' ? 5 : 2;

export type AmbientMoment = {
  album: Album;
  reason: 'related' | 'favorite' | 'forgotten' | 'added' | 'repeat' | 'collection';
  relatedArtist: string;
  favoriteTracks: number;
  historyEnabled: boolean;
  plays: number;
  weekPlays: number;
  firstPlayedAt: number | null;
  lastPlayedAt: number | null;
  reset: boolean;
};

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'}`;
const day = 86_400_000;

export function ambientText(moment: AmbientMoment, historyEnabled: boolean, now = Date.now()) {
  const { album } = moment;
  const history = historyEnabled && moment.historyEnabled && moment.plays > 0;
  const reason = !history && (moment.reason === 'forgotten' || moment.reason === 'repeat') ? 'collection' : moment.reason;
  const label = reason === 'related' ? `More from ${moment.relatedArtist}` : reason === 'favorite' ? 'A favorite'
    : reason === 'forgotten' ? 'Haven’t played in a while' : reason === 'added' ? 'Recently added'
      : reason === 'repeat' ? 'On repeat lately' : 'From your collection';
  const age = Math.max(0, Math.floor((now - album.latest_added_at) / day));
  let context = `${album.track_count === 1 ? 'Single' : 'Album'} · ${plural(album.track_count, 'track')}`;
  if (reason === 'added' && album.latest_added_at > 0) context = age === 0 ? 'Added today' : `Added ${plural(age, 'day')} ago`;
  if (history) {
    if (reason === 'favorite' && moment.favoriteTracks) context = `In your Favorites · ${plural(moment.favoriteTracks, 'favorited track')}`;
    else if (moment.lastPlayedAt && now - moment.lastPlayedAt >= 60 * day) {
      const date = new Date(moment.lastPlayedAt);
      const month = date.toLocaleDateString(undefined, { month: 'long', ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' as const } : {}) });
      context = `Last played in ${month} · ${plural(moment.plays, 'play')}`;
    } else if (moment.weekPlays >= 3) context = `${plural(moment.weekPlays, 'play')} this week`;
    else if (moment.firstPlayedAt && now - moment.firstPlayedAt >= 30 * day) {
      context = `First recorded ${new Date(moment.firstPlayedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} · ${plural(moment.plays, 'play')}`;
    }
  }
  return { label, context };
}

export function ambientLayout(index: number, title: string) {
  const right = index % 2 === 1;
  return { artX: right ? 564 : 96, textX: right ? 96 : 444, y: 96 + [0, 12, 4, 16][index % 4],
    driftX: right ? -12 : 12, titleSize: [...title].length <= 12 ? 64 : [...title].length <= 20 ? 54 : 46 };
}
