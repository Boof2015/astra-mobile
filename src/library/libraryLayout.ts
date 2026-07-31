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
    subtitle: 'Large tiles',
    icon: 'grid-outline',
    columns: 2,
  },
  {
    value: 'grid-3',
    label: 'Medium grid',
    subtitle: 'Medium tiles',
    icon: 'grid-outline',
    columns: 3,
  },
  {
    value: 'grid-4',
    label: 'Compact grid',
    subtitle: 'Small tiles',
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

/**
 * Content width the column counts above were chosen against — a phone in
 * portrait, roughly 412dp of window minus the screen gutters.
 */
const REFERENCE_CONTENT_WIDTH = 380;

/**
 * Guardrail for very wide windows. Past this the grid stops reading as a grid
 * and starts reading as a filmstrip, regardless of what the arithmetic wants.
 */
const MAX_GRID_COLUMNS = 8;

/**
 * Columns for a grid of `contentWidth` dp.
 *
 * `libraryLayoutColumns` returns what the user picked, which is a *density*
 * choice, not literally "three columns forever". Honouring it as a fixed count
 * meant a landscape window spent all its extra width inflating artwork: the
 * same 3 tiles at roughly double the size, so rotating showed about a third as
 * many artists as portrait did despite twice the pixels.
 *
 * So the preference sets a target tile size — the size it implies at
 * `REFERENCE_CONTENT_WIDTH` — and the column count follows the window. "Medium
 * grid" keeps meaning ~127dp tiles whether that works out to 3 columns or 6.
 *
 * Never returns fewer columns than the preference asks for: on windows narrower
 * than the reference this is exactly the old behaviour, so no phone in portrait
 * sees its library reflow.
 */
export function libraryGridColumns(layout: LibraryLayout, contentWidth: number): number {
  const base = libraryLayoutColumns(layout);
  // A list is a list at any width; widening it is a different design decision.
  if (base <= 1) return 1;
  // Before first layout there's nothing to divide by — fall back to the
  // preference so the first frame matches what the user chose.
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) return base;
  const targetTileWidth = REFERENCE_CONTENT_WIDTH / base;
  return Math.min(
    MAX_GRID_COLUMNS,
    Math.max(base, Math.round(contentWidth / targetTileWidth))
  );
}

export function libraryLayoutLabel(layout: LibraryLayout): string {
  return LIBRARY_LAYOUT_OPTIONS.find((option) => option.value === layout)?.label
    ?? LIBRARY_LAYOUT_OPTIONS.find((option) => option.value === DEFAULT_LIBRARY_LAYOUT)!.label;
}
