import type { DesktopRemotePairingInput } from '@/types/desktopRemote';

const PAIRING_TICKET_PATTERN = /^[A-Za-z0-9_-]{16,}$/;
const PAIRING_PIN_PATTERN = /^\d{6}$/;

function normalizeBaseUrl(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function extractPairFromUrl(url: URL): string {
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
  const hashTicket = hashParams.get('pair')?.trim();
  if (hashTicket) return hashTicket;
  return url.searchParams.get('pair')?.trim() ?? '';
}

export function parseDesktopRemotePairingInput(rawInput: string): DesktopRemotePairingInput | null {
  const input = rawInput.trim();
  if (!input) return null;

  try {
    const parsed = new URL(input);
    if (parsed.protocol === 'astra:') {
      const baseUrl = normalizeBaseUrl(parsed.searchParams.get('baseUrl') ?? '');
      const ticket = parsed.searchParams.get('ticket')?.trim() ?? parsed.searchParams.get('pair')?.trim() ?? '';
      return baseUrl && PAIRING_TICKET_PATTERN.test(ticket) ? { baseUrl, ticket } : null;
    }

    const ticket = extractPairFromUrl(parsed);
    const baseUrl = normalizeBaseUrl(parsed.origin);
    return baseUrl && PAIRING_TICKET_PATTERN.test(ticket) ? { baseUrl, ticket } : null;
  } catch {
    return PAIRING_TICKET_PATTERN.test(input) ? { baseUrl: '', ticket: input } : null;
  }
}

export function parseDesktopRemoteManualInput(baseUrl: string, ticket: string): DesktopRemotePairingInput | null {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedTicket = ticket.trim();
  if (!normalizedBaseUrl || !PAIRING_TICKET_PATTERN.test(normalizedTicket)) return null;
  return { baseUrl: normalizedBaseUrl, ticket: normalizedTicket };
}

export function normalizeDesktopRemotePinInput(pin: string): string | null {
  const normalizedPin = pin.replace(/\s+/g, '');
  return PAIRING_PIN_PATTERN.test(normalizedPin) ? normalizedPin : null;
}
