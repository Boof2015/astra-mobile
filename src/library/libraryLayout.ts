export type LibraryLayout = 'list' | 'grid-2' | 'grid-3' | 'grid-4';

export interface LibraryLayoutOption {
  value: LibraryLayout;
  label: string;
  subtitle: string;
  icon: 'list-outline' | 'grid-outline';
  columns: number;
}

export const DEFAULT_LIBRARY_LAYOUT: LibraryLayout = 'grid-3';

export const LIBRARY_LAYOUT_OPTIONS: readonly LibraryLayoutOption[] = [
  {
    value: 'list',
    label: 'List',
    subtitle: 'Compact rows',
    icon: 'list-outline',
    columns: 1,
  },
  {
    value: 'grid-2',
    label: 'Large grid',
    subtitle: '2 columns',
    icon: 'grid-outline',
    columns: 2,
  },
  {
    value: 'grid-3',
    label: 'Medium grid',
    subtitle: '3 columns',
    icon: 'grid-outline',
    columns: 3,
  },
  {
    value: 'grid-4',
    label: 'Compact grid',
    subtitle: '4 columns',
    icon: 'grid-outline',
    columns: 4,
  },
] as const;

const LIBRARY_LAYOUTS = new Set<LibraryLayout>(
  LIBRARY_LAYOUT_OPTIONS.map((option) => option.value)
);

export function parseLibraryLayout(value: string | null): LibraryLayout {
  return value !== null && LIBRARY_LAYOUTS.has(value as LibraryLayout)
    ? (value as LibraryLayout)
    : DEFAULT_LIBRARY_LAYOUT;
}

export function libraryLayoutColumns(layout: LibraryLayout): number {
  return LIBRARY_LAYOUT_OPTIONS.find((option) => option.value === layout)?.columns
    ?? LIBRARY_LAYOUT_OPTIONS.find((option) => option.value === DEFAULT_LIBRARY_LAYOUT)!.columns;
}

export function libraryLayoutLabel(layout: LibraryLayout): string {
  return LIBRARY_LAYOUT_OPTIONS.find((option) => option.value === layout)?.label
    ?? LIBRARY_LAYOUT_OPTIONS.find((option) => option.value === DEFAULT_LIBRARY_LAYOUT)!.label;
}
