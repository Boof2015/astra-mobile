export function formatListeningTime(totalSeconds: number, compact = false): string {
  const seconds = Math.max(0, Math.round(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return compact ? `${hours}h ${minutes}m` : `${hours} hr ${minutes} min`;
  if (minutes > 0) return compact ? `${minutes}m` : `${minutes} min`;
  return compact ? `${seconds}s` : `${seconds} sec`;
}

export function formatRecordedSince(timestamp: number | null): string {
  if (timestamp == null) return 'No detailed history recorded yet';
  return `Recorded on this phone since ${new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(timestamp))}`;
}

export function formatBucketDate(startAt: number, endAt: number): string {
  const start = new Date(startAt);
  const end = new Date(Math.max(startAt, endAt - 1));
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  if (start.toDateString() === end.toDateString()) return formatter.format(start);
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}
