/** 271.3 -> "4:31"; hours roll into minutes ("73:09") like desktop track lists. */
export function formatDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const total = Math.floor(safe);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Coarse "how long ago" for status lines ("just now", "5 min ago", "2 h ago"). */
export function formatRelativeTime(timestampMs: number): string {
  const elapsed = Date.now() - timestampMs;
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return 'just now';
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}
