import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { findNodeHandle, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { FocusLinks } from './focusGeometry';

type Entry = { node: View; links: FocusLinks };
type FocusContext = {
  focused: string;
  request: (key: string) => void;
  register: (key: string, entry: Entry | null) => void;
  activate: (key: string) => void;
};
const Context = createContext<FocusContext | null>(null);
const EnabledContext = createContext(true);

export function TvFocusRegion({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <EnabledContext.Provider value={enabled}><View pointerEvents={enabled ? 'auto' : 'none'}
    importantForAccessibility={enabled ? 'auto' : 'no-hide-descendants'} style={StyleSheet.absoluteFill}>{children}</View></EnabledContext.Provider>;
}

/** Native focus remains the owner of OK/accessibility. Explicit native edges
 * prevent Android's geometric fallback from skipping groups or wrapping rows.
 * A missing neighbor resolves to self until its paged cell is mounted. */
export function TvFocusProvider({ children }: { children: ReactNode }) {
  const [focused, setFocused] = useState('nav:home');
  const registryRef = useRef({ entries: new Map<string, Entry>(), wanted: 'nav:home', frame: 0, releaseFrame: 0 });
  const flush = useCallback(() => {
    const registry = registryRef.current;
    cancelAnimationFrame(registry.frame);
    registry.frame = requestAnimationFrame(() => {
      for (const [key, { node, links }] of registry.entries) {
        const self = findNodeHandle(node);
        const target = (direction: keyof FocusLinks) => findNodeHandle(registry.entries.get(links[direction] ?? key)?.node ?? node) ?? self;
        node.setNativeProps({ nextFocusUp: target('up'), nextFocusDown: target('down'), nextFocusLeft: target('left'), nextFocusRight: target('right') });
      }
      const wanted = registry.entries.get(registry.wanted);
      if (wanted) {
        registry.wanted = '';
        wanted.node.setNativeProps({ hasTVPreferredFocus: true });
        // Fabric retains imperative props. Leaving preferredFocus=true would
        // make subsequent edge updates pull focus back to this old opener.
        registry.releaseFrame = requestAnimationFrame(() => wanted.node.setNativeProps({ hasTVPreferredFocus: false }));
      }
    });
  }, []);
  useEffect(() => { const registry = registryRef.current; return () => { cancelAnimationFrame(registry.frame); cancelAnimationFrame(registry.releaseFrame); }; }, []);
  const request = useCallback((key: string) => { registryRef.current.wanted = key; flush(); }, [flush]);
  const register = useCallback((key: string, entry: Entry | null) => {
    const registry = registryRef.current;
    if (entry) registry.entries.set(key, entry); else registry.entries.delete(key);
    flush();
  }, [flush]);
  const context = useMemo(() => ({ focused, request, register, activate: setFocused }), [focused, request, register]);
  return <Context.Provider value={context}>{children}</Context.Provider>;
}

export function useTvFocus() {
  const value = useContext(Context);
  if (!value) throw new Error('TV controls require TvFocusProvider');
  return value;
}

export function TvButton({ id, links = {}, onPress, onFocus, children, style, ringStyle, disabled = false, label }: {
  id: string; links?: FocusLinks; onPress: () => void; onFocus?: () => void;
  children: ReactNode; style?: StyleProp<ViewStyle>; ringStyle?: StyleProp<ViewStyle>;
  disabled?: boolean; label: string;
}) {
  const { focused, register, activate } = useTvFocus();
  const enabled = useContext(EnabledContext) && !disabled;
  const [node, setNode] = useState<View | null>(null);
  const { up, down, left, right } = links;
  useLayoutEffect(() => {
    if (node && enabled) register(id, { node, links: { up, down, left, right } });
    return () => register(id, null);
  }, [node, enabled, id, up, down, left, right, register]);
  return (
    <Pressable ref={setNode} collapsable={false} focusable={enabled} accessible={enabled}
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
      disabled={!enabled} onPress={onPress}
      onFocus={event => {
        if (event.target !== event.currentTarget) return;
        activate(id); onFocus?.();
      }}
      style={[styles.button, style, disabled && styles.disabled]}>
      {children}
      {enabled && focused === id && <View pointerEvents="none" style={[styles.ring, ringStyle]} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { borderRadius: 8, justifyContent: 'center' },
  disabled: { opacity: 0.38 },
  ring: { position: 'absolute', top: -3, right: -3, bottom: -3, left: -3, borderWidth: 2, borderColor: '#e8eeff', borderRadius: 11 },
});
