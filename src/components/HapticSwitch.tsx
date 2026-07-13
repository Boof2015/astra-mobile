import { Switch, type SwitchProps } from 'react-native';
import { hapticForToggle } from '@/lib/hapticCatalog';
import { playHaptic } from '@/lib/haptics';

export interface HapticSwitchProps
  extends Omit<SwitchProps, 'value' | 'onValueChange'> {
  value: boolean;
  onValueChange: (value: boolean) => void;
}

/** Switch feedback fires only for a user-requested value transition. */
export function HapticSwitch({
  value,
  onValueChange,
  ...props
}: HapticSwitchProps) {
  const handleValueChange = (nextValue: boolean) => {
    if (nextValue !== value) playHaptic(hapticForToggle(nextValue));
    onValueChange(nextValue);
  };

  return (
    <Switch
      {...props}
      value={value}
      onValueChange={handleValueChange}
    />
  );
}

export default HapticSwitch;
