// M3U/M3U8 parse + serialize — ported from the desktop playlist import/export
// (playlistImport.ts parseM3uDocument/parseExtInfLine, library.ts formatM3u*).
// Pure string handling; file IO and library matching live in playlistFiles.ts.

export interface M3uEntry {
  path: string;
  title?: string;
  artist?: string;
}

export interface M3uExportEntry {
  path: string;
  title: string | null;
  artist: string | null;
  duration: number | null;
}

function stripUtf8Bom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function toOptionalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseExtInfLine(line: string): { title?: string; artist?: string } | null {
  const commaIndex = line.indexOf(',');
  if (commaIndex < 0) return null;

  const display = toOptionalValue(line.slice(commaIndex + 1));
  if (!display) return null;

  const dashIndex = display.indexOf(' - ');
  if (dashIndex <= 0 || dashIndex >= display.length - 3) {
    return { title: display };
  }
  return {
    artist: toOptionalValue(display.slice(0, dashIndex)),
    title: toOptionalValue(display.slice(dashIndex + 3)),
  };
}

export function parseM3u(content: string): M3uEntry[] {
  const entries: M3uEntry[] = [];
  const lines = stripUtf8Bom(content).split(/\r?\n/);
  let pendingInfo: { title?: string; artist?: string } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^#EXTINF:/i.test(line)) {
      pendingInfo = parseExtInfLine(line);
      continue;
    }
    if (line.startsWith('#')) continue;

    entries.push({ path: line, title: pendingInfo?.title, artist: pendingInfo?.artist });
    pendingInfo = null;
  }
  return entries;
}

function normalizeM3uLineValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function basenameFromPath(value: string): string {
  const normalized = normalizeM3uLineValue(value);
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || normalized;
}

function formatM3uDuration(duration: number | null): number {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
    return -1;
  }
  return Math.max(0, Math.round(duration));
}

function formatM3uDisplayTitle(entry: M3uExportEntry): string {
  const title = normalizeM3uLineValue(entry.title ?? '');
  const artist = normalizeM3uLineValue(entry.artist ?? '');

  if (title && artist) return `${artist} - ${title}`;
  if (title) return title;
  if (artist) return artist;
  return basenameFromPath(entry.path);
}

export function serializeM3u(entries: M3uExportEntry[]): string {
  const lines = ['#EXTM3U'];
  for (const entry of entries) {
    lines.push(`#EXTINF:${formatM3uDuration(entry.duration)},${formatM3uDisplayTitle(entry)}`);
    lines.push(normalizeM3uLineValue(entry.path).replace(/\\/g, '/'));
  }
  return `${lines.join('\n')}\n`;
}
