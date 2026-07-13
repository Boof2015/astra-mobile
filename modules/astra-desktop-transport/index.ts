import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';

export interface AstraDesktopTransportResponse {
  status: number;
  body: string;
}

export interface AstraDesktopPinAttempt {
  attemptId: string;
  requestId: string;
  expiresAt: number;
  desktopName: string | null;
  certificateFingerprint: string;
  protocolVersion: number;
}

export interface AstraDesktopPinResult {
  controlToken: string;
  syncToken: string;
  deviceId: string | null;
  issuedAt: number;
  identityJson: string;
  certificateFingerprint: string;
}

type AstraDesktopTransportEvents = {
  onDesktopTransportSse: (event: {
    streamId: string;
    event: string;
    data: string;
  }) => void;
  onDesktopTransportClosed: (event: {
    streamId: string;
    unauthorized: boolean;
    message: string;
  }) => void;
};

declare class AstraDesktopTransportModuleType extends NativeModule<AstraDesktopTransportEvents> {
  requestJson(
    baseUrl: string,
    path: string,
    method: 'GET' | 'POST',
    body: string | null,
    token: string | null,
    certificateFingerprint: string,
    timeoutMs: number
  ): Promise<AstraDesktopTransportResponse>;
  startEventStream(baseUrl: string, token: string, certificateFingerprint: string): Promise<string>;
  stopEventStream(streamId: string): void;
  beginPinPairing(baseUrl: string, deviceName: string, clientLabel: string): Promise<AstraDesktopPinAttempt>;
  confirmPinPairing(attemptId: string, enteredCode: string): Promise<AstraDesktopPinResult>;
}

export const AstraDesktopTransport =
  requireOptionalNativeModule<AstraDesktopTransportModuleType>('AstraDesktopTransport');

export const desktopPinnedTransportAvailable = AstraDesktopTransport != null;
