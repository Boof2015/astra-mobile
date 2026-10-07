import { useMemo } from 'react';
import { useThemeStore } from '@/stores/themeStore';
import { tvPalette } from './tvTheme';

export function useTvTheme() {
  const theme = useThemeStore(state => state.theme);
  return useMemo(() => tvPalette(theme), [theme]);
}
