import { StyleSheet } from 'react-native';
import { useThemeStore } from '@/stores/themeStore';
import type { Palette } from './palettes';
import type { AppTheme } from './resolve';

/** The resolved theme (id, isDark, statusBarStyle, colors). */
export function useTheme(): AppTheme {
  return useThemeStore((s) => s.theme);
}

/** Just the palette — the common case for inline `colors.x` props. */
export function useColors(): Palette {
  return useThemeStore((s) => s.theme.colors);
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
): () => T {
  const cache = new WeakMap<Palette, T>();
  return function useThemedStyles(): T {
    const colors = useThemeStore((s) => s.theme.colors);
    let styles = cache.get(colors);
    if (styles === undefined) {
      styles = StyleSheet.create(factory(colors));
      cache.set(colors, styles);
    }
    return styles;
  };
}
