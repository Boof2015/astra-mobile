export interface VoiceRequest {
  query?: string; focus?: string; title?: string; artist?: string; album?: string; playlist?: string;
}
const clean = (value?: string | null) => value?.replace(/\s+/g, ' ').trim() || null;
export function voiceIntent(request: VoiceRequest): { focus: string | null; term: string | null } {
  const focus = clean(request.focus)?.toLowerCase();
  if (focus && ['track', 'album', 'artist', 'playlist'].includes(focus)) {
    const field = focus === 'track' ? request.title : request[focus as 'album' | 'artist' | 'playlist'];
    return { focus, term: clean(field) ?? clean(request.query) };
  }
  for (const [kind, value] of [['track', request.title], ['playlist', request.playlist], ['album', request.album], ['artist', request.artist]]) {
    if (clean(value)) return { focus: kind!, term: clean(value) };
  }
  return { focus: null, term: clean(request.query) };
}
function score(value: string | null | undefined, term: string): number {
  const valueKey = clean(value)?.toLocaleLowerCase();
  const termKey = clean(term)?.toLocaleLowerCase();
  if (!valueKey || !termKey) return Infinity;
  return valueKey === termKey ? 0 : valueKey.startsWith(termKey) ? 10 : valueKey.includes(termKey) ? 20 : Infinity;
}
export function constrainedTrackScore(track: { title: string; artist: string; album: string }, title: string, artist?: string, album?: string): number {
  return score(track.title, title) + (clean(artist) ? score(track.artist, artist!) : 0) + (clean(album) ? score(track.album, album!) : 0);
}
