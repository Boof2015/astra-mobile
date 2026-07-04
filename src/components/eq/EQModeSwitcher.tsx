import { SegmentedControl } from '@/components/SegmentedControl';
import type { EQMode } from '@/types/audio';

const MODES: { key: EQMode; label: string }[] = [
  { key: 'parametric', label: 'Parametric' },
  { key: 'graphic', label: 'Graphic' },
];

/** Two-segment Parametric | Graphic control (shared SegmentedControl). */
export function EQModeSwitcher({
  value,
  onChange,
}: {
  value: EQMode;
  onChange: (mode: EQMode) => void;
}) {
  return (
    <SegmentedControl
      segments={MODES}
      value={value}
      onChange={(key) => onChange(key as EQMode)}
    />
  );
}

export default EQModeSwitcher;
