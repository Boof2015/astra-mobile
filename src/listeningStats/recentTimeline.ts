import type { RecentTimelineEntry } from '../../modules/astra-library-scanner';

export function localDayStart(time: number): number {
  return new Date(time).setHours(0, 0, 0, 0);
}

export function nextLocalDay(time: number): number {
  const date = new Date(localDayStart(time));
  return date.setDate(date.getDate() + 1);
}

let dateLabel: Intl.DateTimeFormat;
let yearLabel: Intl.DateTimeFormat;
let timeLabel: Intl.DateTimeFormat;

export function formatPlayTime(time: number): string {
  timeLabel ??= new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  return timeLabel.format(time);
}

export function formatPlayDay(day: number, today: number): string {
  if (day === today) return 'Today';
  if (nextLocalDay(day) === today) return 'Yesterday';
  if (new Date(day).getFullYear() === new Date(today).getFullYear()) {
    dateLabel ??= new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    return dateLabel.format(day);
  }
  yearLabel ??= new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  return yearLabel.format(day);
}

export type TimelineRow<T> =
  | { kind: 'heading'; key: string; title: string }
  | { kind: 'play'; key: string; entry: RecentTimelineEntry<T>; count: number };

/** Input is in descending (play time, occurrence ID) order within each section. */
export function timelineRows<T>(
  entries: RecentTimelineEntry<T>[], today: number, prior: TimelineRow<T>[] = [],
): TimelineRow<T>[] {
  const rows = prior.slice();
  const tail = prior[prior.length - 1];
  const lastEntry = tail?.kind === 'play' ? tail.entry : undefined;
  let lastDay = lastEntry && localDayStart(lastEntry.playedAt);
  let lastKind = lastEntry?.kind;
  for (const entry of entries) {
    const day = localDayStart(entry.playedAt);
    if (entry.kind === 'summary' && lastKind !== 'summary') {
      rows.push({ kind: 'heading', key: 'summary', title: 'Last known plays' });
    }
    if (day !== lastDay || entry.kind !== lastKind) {
      rows.push({ kind: 'heading', key: `day:${entry.kind}:${day}`, title: formatPlayDay(day, today) });
    }
    const previous = rows[rows.length - 1];
    if (entry.kind === 'session' && previous?.kind === 'play' && previous.entry.path === entry.path) {
      rows[rows.length - 1] = { ...previous, count: previous.count + 1 };
    } else {
      rows.push({ kind: 'play', key: `${entry.kind}:${entry.id}`, entry, count: 1 });
    }
    lastDay = day;
    lastKind = entry.kind;
  }
  return rows;
}
