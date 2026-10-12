import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';

type BackContext = { register: (handler: () => boolean) => () => void; handle: () => boolean };
const Context = createContext<BackContext | null>(null);

/** Local adjustment modes run before route Back, independent of effect/listener
 * registration order. Overlays are still handled first by the shell. */
export function TvBackProvider({ children }: { children: ReactNode }) {
  const handlers = useRef(new Set<() => boolean>());
  const register = useCallback((handler: () => boolean) => {
    handlers.current.add(handler);
    return () => { handlers.current.delete(handler); };
  }, []);
  const handle = useCallback(() => [...handlers.current].reverse().some(handler => handler()), []);
  const value = useMemo(() => ({ register, handle }), [register, handle]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useTvBack() {
  const value = useContext(Context);
  if (!value) throw new Error('TV Back handlers require TvBackProvider');
  return value;
}

export function useTvBackHandler(enabled: boolean, handler: () => boolean) {
  const { register } = useTvBack();
  const latest = useRef(handler);
  useLayoutEffect(() => { latest.current = handler; });
  useEffect(() => enabled ? register(() => latest.current()) : undefined, [enabled, register]);
}
