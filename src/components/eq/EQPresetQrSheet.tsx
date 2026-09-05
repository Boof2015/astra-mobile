import { ActionButton } from '@/components/ActionButton';
import {
  StyleSheet,
  View
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Text } from '@/components/Text';
import { AppSheetFooter, AppSheetTitle } from '@/components/sheets/AppSheet';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { EqSheet } from './EqSheet';

interface EQPresetQrSheetProps {
  presetName: string;
  value: string;
  onClose: () => void;
}

export function EQPresetQrSheet({ presetName, value, onClose }: EQPresetQrSheetProps) {
  const styles = useStyles();
  const colors = useColors();

  return (
    <EqSheet onClose={onClose} scrollable>
      <AppSheetTitle title="Preset QR" />
      <View style={styles.qrWrap}>
        <QRCode value={value} size={220} color="#000000" backgroundColor="#ffffff" quietZone={12} ecl="M" />
      </View>
      <Text variant="label" color={colors.textSecondary} style={styles.name}>
        {presetName}
      </Text>
      <AppSheetFooter>
        <ActionButton
          onPress={onClose}
          variant="primary"
          label="Done"
        />
      </AppSheetFooter>
    </EqSheet>
  );
}

const useStyles = createThemedStyles((colors) => ({
  qrWrap: {
    alignSelf: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  name: {
    alignSelf: 'center',
    maxWidth: 260,
    marginTop: spacing.md,
  },
}));

export default EQPresetQrSheet;
