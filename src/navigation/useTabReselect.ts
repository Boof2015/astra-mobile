import { useEffect } from 'react';
import { subscribeTabReselect } from './tabReselect';

/**
 * Run `onReselect` when the tab bar reports a press on this tab while it was
 * already focused and sitting at its root.
 *
 * React Compiler memoizes the caller's closure, so the handler identity is
 * stable across renders and no ref-latching is needed here.
 */
export function useTabReselect(tabName: string, onReselect: () => void): void {
  useEffect(() => subscribeTabReselect(tabName, onReselect), [tabName, onReselect]);
}
