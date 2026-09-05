import { actionButtonStyle, actionButtonTextStyle } from '@/theme/actionButtons';
import {
  StyleSheet,
  View
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Text } from '@/components/Text';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable } from '@/components/AppPressable';
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
    <EqSheet onClose={onClose}>
      <Text variant="heading" style={styles.title}>
        Preset QR
      </Text>
      <View style={styles.qrWrap}>
        <QRCode value={value} size={220} color="#000000" backgroundColor="#ffffff" quietZone={12} ecl="M" />
      </View>
      <Text variant="label" numberOfLines={1} color={colors.textSecondary} style={styles.name}>
        {presetName}
      </Text>
      <AppPressable feedback="accent"  style={styles.done} onPress={onClose}>
        <Text style={actionButtonTextStyle(colors, 'primary')} variant="label">
          Done
        </Text>
      </AppPressable>
    </EqSheet>
  );
}

const useStyles = createThemedStyles((colors) => ({
  title: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
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
  done: {
    ...actionButtonStyle(colors, 'primary'),
    alignSelf: 'flex-end',
    marginTop: spacing.lg,
  },
}));

export default EQPresetQrSheet;
