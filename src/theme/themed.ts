import { createContext, createElement, useContext, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { useThemeStore } from '@/stores/themeStore';
import type { Palette } from './palettes';
import type { AppTheme } from './resolve';

const ScopedPaletteContext = createContext<Palette | null>(null);

export function ScopedPaletteProvider({
  colors,
  children,
}: {
  colors: Palette;
  children: ReactNode;
}) {
  return createElement(ScopedPaletteContext.Provider, { value: colors }, children);
}

/** The resolved theme (id, isDark, statusBarStyle, colors). */
export function useTheme(): AppTheme {
  return useThemeStore((s) => s.theme);
}

/** Just the palette — the common case for inline `colors.x` props. */
export function useColors(): Palette {
  const scoped = useContext(ScopedPaletteContext);
  const global = useThemeStore((s) => s.theme.colors);
  return scoped ?? global;
}

/**
 * Module-scope factory for theme-aware styles:
 *
 *   const useStyles = createThemedStyles((colors) => ({ ... }));
 *   // in the component:
 *   const styles = useStyles();
 *
 * Styles are built lazily and cached per palette OBJECT IDENTITY — one
 * StyleSheet build per theme per file, referentially stable across renders
 * (so downstream memoization behaves exactly like the old module-scope
 * constant). The WeakMap write during render is an idempotent lazy-init on an
 * immutable key, which is safe under React's concurrent re-renders.
 */
export function createThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: Palette) => T,
): (override?: Palette) => T {
  const cache = new WeakMap<Palette, T>();
  return function useThemedStyles(override?: Palette): T {
    const inherited = useColors();
    const colors = override ?? inherited;
    let styles = cache.get(colors);
    if (styles === undefined) {
      styles = StyleSheet.create(factory(colors));
      cache.set(colors, styles);
    }
    return styles;
  };
}
