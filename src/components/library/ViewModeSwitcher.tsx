import { SegmentedControl } from '@/components/SegmentedControl';
import {
  LIBRARY_VIEW_MODES,
  type LibraryViewMode,
} from '@/library/libraryViewMode';

export type { LibraryViewMode } from '@/library/libraryViewMode';

export function ViewModeSwitcher({
  value,
  onChange,
}: {
  value: LibraryViewMode;
  onChange: (mode: LibraryViewMode) => void;
}) {
  return (
    <SegmentedControl
      segments={[...LIBRARY_VIEW_MODES]}
      value={value}
      onChange={(key) => onChange(key as LibraryViewMode)}
    />
  );
}
