import type { DesktopRemotePairingInput } from '@/types/desktopRemote';

const PAIRING_TICKET_PATTERN = /^[A-Za-z0-9_-]{16,}$/;
const PAIRING_PIN_PATTERN = /^\d{6}$/;

function normalizeBaseUrl(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function normalizeFingerprint(value: string): string | null {
  const compact = value.trim().toUpperCase().replace(/[^0-9A-F]/g, '');
  if (!/^[0-9A-F]{64}$/.test(compact)) return null;
  return compact.match(/.{2}/g)?.join(':') ?? null;
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
      const endpointUuid = parsed.searchParams.get('endpointUuid')?.trim() ?? '';
      const fingerprint = normalizeFingerprint(parsed.searchParams.get('fingerprint') ?? '');
      const protocolVersion = Number(parsed.searchParams.get('protocolVersion'));
      return baseUrl && endpointUuid && fingerprint && protocolVersion === 3 && PAIRING_TICKET_PATTERN.test(ticket)
        ? { baseUrl, ticket, endpointUuid, protocolVersion: 3, certificateFingerprint: fingerprint }
        : null;
    }

    const ticket = extractPairFromUrl(parsed);
    const baseUrl = normalizeBaseUrl(parsed.origin);
    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    const endpointUuid = hashParams.get('endpointUuid')?.trim() ?? parsed.searchParams.get('endpointUuid')?.trim() ?? '';
    const fingerprint = normalizeFingerprint(hashParams.get('fingerprint') ?? parsed.searchParams.get('fingerprint') ?? '');
    const protocolVersion = Number(hashParams.get('protocolVersion') ?? parsed.searchParams.get('protocolVersion'));
    return baseUrl && endpointUuid && fingerprint && protocolVersion === 3 && PAIRING_TICKET_PATTERN.test(ticket)
      ? { baseUrl, ticket, endpointUuid, protocolVersion: 3, certificateFingerprint: fingerprint }
      : null;
  } catch {
    return null;
  }
}

export function parseDesktopRemoteManualInput(
  baseUrl: string,
  ticket: string,
  endpointUuid: string,
  certificateFingerprint: string
): DesktopRemotePairingInput | null {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedTicket = ticket.trim();
  const normalizedEndpointUuid = endpointUuid.trim();
  const normalizedFingerprint = normalizeFingerprint(certificateFingerprint);
  if (!normalizedBaseUrl || !normalizedEndpointUuid || !normalizedFingerprint || !PAIRING_TICKET_PATTERN.test(normalizedTicket)) return null;
  return {
    baseUrl: normalizedBaseUrl,
    ticket: normalizedTicket,
    endpointUuid: normalizedEndpointUuid,
    protocolVersion: 3,
    certificateFingerprint: normalizedFingerprint,
  };
}

export function normalizeDesktopRemotePinInput(pin: string): string | null {
  const normalizedPin = pin.replace(/\s+/g, '');
  return PAIRING_PIN_PATTERN.test(normalizedPin) ? normalizedPin : null;
}
