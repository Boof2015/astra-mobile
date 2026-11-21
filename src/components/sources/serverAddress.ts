/**
 * Server-address parsing and connection-error wording, shared by the onboarding
 * connect page and Settings › Servers. Pure: no React, no network.
 */

export type ServerKind = 'subsonic' | 'jellyfin';

export type ParsedServerAddress =
  | { ok: true; baseUrl: string; hostname: string }
  | { ok: false; message: string };

export const SERVER_ADDRESS_HINT =
  'Include http:// or https:// and the port. Astra names the server after its address; you can rename it later.';

/**
 * Accepts what people actually type. The services normalize again before every
 * request; this exists so a bad address is caught before a 12-second timeout,
 * and so the server can be named after its host.
 */
export function parseServerAddress(raw: string): ParsedServerAddress {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, message: 'Enter the server address.' };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, message: 'Enter an address that starts with http:// or https://, like http://192.168.1.50:4533.' };
  }
  const protocol = url.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    return { ok: false, message: 'Enter an address that starts with http:// or https://, like http://192.168.1.50:4533.' };
  }
  if (!url.hostname) return { ok: false, message: 'That address is missing the server name or IP.' };
  if (url.username || url.password) {
    return { ok: false, message: 'Leave your login out of the address. Enter it in the fields below.' };
  }
  return { ok: true, baseUrl: trimmed.replace(/\/+$/, ''), hostname: url.hostname };
}

/** The name a new server gets when the user doesn't type one. */
export function defaultServerName(raw: string): string | null {
  const parsed = parseServerAddress(raw);
  return parsed.ok ? parsed.hostname : null;
}

/**
 * Turns what the Subsonic/Jellyfin clients throw into something a person can act
 * on. Unknown errors pass through untouched: a server's own message (Navidrome's
 * "Wrong username or password", say) is usually already the best wording.
 */
export function describeConnectError(error: unknown, kind: ServerKind, hostname: string | null): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const name = error instanceof Error ? error.name : '';
  const label = kind === 'jellyfin' ? 'Jellyfin' : 'Subsonic';
  const where = hostname ?? 'the server';
  if (/\((401|403)\)/.test(raw) || /wrong username or password|unauthori[sz]ed|not authori[sz]ed/i.test(raw)) {
    return kind === 'jellyfin'
      ? 'Jellyfin didn’t accept that username and password.'
      : 'The server didn’t accept that username and password.';
  }
  if (name === 'AbortError' || /network request failed|abort|timed? ?out|failed to connect|unable to resolve|ECONN/i.test(raw)) {
    return `Couldn’t reach ${where}. Check the address and that your phone is on the same network.`;
  }
  if (/\((404|405)\)/.test(raw) || /invalid (subsonic|jellyfin) (response|authentication)|JSON|unexpected token/i.test(raw)) {
    return `${where} answered, but it doesn’t look like a ${label} server. Check the address and port.`;
  }
  return raw || 'Couldn’t connect to the server.';
}
