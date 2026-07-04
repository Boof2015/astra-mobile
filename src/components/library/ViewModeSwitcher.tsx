import { SegmentedControl } from '@/components/SegmentedControl';

export type LibraryViewMode = 'albums' | 'artists' | 'tracks' | 'playlists' | 'folders';

const MODES: { key: LibraryViewMode; label: string }[] = [
  { key: 'albums', label: 'Albums' },
  { key: 'artists', label: 'Artists' },
  { key: 'tracks', label: 'Tracks' },
  { key: 'playlists', label: 'Playlists' },
  { key: 'folders', label: 'Folders' },
];

export function ViewModeSwitcher({
  value,
  onChange,
}: {
  value: LibraryViewMode;
  onChange: (mode: LibraryViewMode) => void;
}) {
  return (
    <SegmentedControl
      segments={MODES}
      value={value}
      onChange={(key) => onChange(key as LibraryViewMode)}
    />
  );
}
