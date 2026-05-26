import { View, StyleSheet, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '@/theme';

interface ScreenProps extends ViewProps {
  /** Apply default horizontal padding. */
  padded?: boolean;
}

/** Base screen container: black background + top safe-area inset. */
export function Screen({ children, style, padded = true, ...rest }: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }, style]} {...rest}>
      <View style={[styles.inner, padded && styles.padded]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  inner: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: spacing.lg,
  },
});

export default Screen;
