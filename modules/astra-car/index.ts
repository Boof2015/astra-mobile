import type { NativePlaybackWindow } from '../astra-library-scanner';
import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';

export interface CarPlaybackContext {
  shuffle: boolean;
  repeat: 'none' | 'all' | 'one';
  sessionId: string | null;
}

export interface CarResumeState {
  path: string | null;
  position: number;
  session: string | null;
  entryId: string | null;
  queuePosition?: number | null;
  shuffle: boolean;
  repeat: CarPlaybackContext["repeat"];
  savedAt: number;
}

declare class AstraCarModuleType extends NativeModule {
  getResumeState(): Promise<CarResumeState | null>;
  setPlaybackContext(context: CarPlaybackContext): void;
  /** Authenticated templates are kept only in native process memory. */
  registerArtworkSource(sourceId: number, template: string | null): void;
  completeCommand(requestId: string, error: string | null): void;
  isCommandActive(requestId: string): Promise<boolean>;
  selectQueueEntry<T>(session: string, entryId: string): Promise<NativePlaybackWindow<T> | null>;
  resolveQueueEntry(session: string, entryId: string): Promise<number | null>;
}

const native = requireOptionalNativeModule<AstraCarModuleType>('AstraCar');
export const AstraCar = (native ?? {
  getResumeState: async () => null,
  setPlaybackContext: () => {},
  registerArtworkSource: () => {},
  completeCommand: () => {},
  isCommandActive: async () => false,
  resolveQueueEntry: async () => null,
  selectQueueEntry: async () => null,
}) as AstraCarModuleType;
