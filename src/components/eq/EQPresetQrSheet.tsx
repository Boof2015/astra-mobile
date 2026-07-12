import {
  Pressable,
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
import { useRipple } from '@/theme/ripple';
import { EqSheet } from './EqSheet';

interface EQPresetQrSheetProps {
  presetName: string;
  value: string;
  onClose: () => void;
}

export function EQPresetQrSheet({ presetName, value, onClose }: EQPresetQrSheetProps) {
  const styles = useStyles();
  const ripple = useRipple();
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
      <Pressable android_ripple={ripple.bounded} style={styles.done} onPress={onClose}>
        <Text variant="label" color={colors.accentTextStrong}>
          Done
        </Text>
      </Pressable>
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
    alignSelf: 'flex-end',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
  },
}));

export default EQPresetQrSheet;
