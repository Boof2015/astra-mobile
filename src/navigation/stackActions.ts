/**
 * Minimal stack action creators.
 *
 * Expo Router 56 vendors React Navigation (`expo-router/build/react-navigation`)
 * and `@react-navigation/native` is not an installed package, so `StackActions`
 * cannot be imported. These action objects are the same shape the vendored
 * `StackRouter` matches on, and dispatching them with a `target` routes the
 * action to a specific (here: nested) navigator.
 */

/** Pops a stack back to its first route. */
export function popToTop(): { type: 'POP_TO_TOP' } {
  return { type: 'POP_TO_TOP' };
}
