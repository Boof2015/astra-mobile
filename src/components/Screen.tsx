import {
  View,
  type ViewProps
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShellRailPresent } from '@/navigation/shellRailContext';
import { useShellLayout } from '@/navigation/useShellLayout';
import { spacing } from '@/theme';
import { createThemedStyles } from '@/theme/themed';

interface ScreenProps extends ViewProps {
  /** Apply default horizontal padding. */
  padded?: boolean;
}

/**
 * Base screen container: background + safe-area insets.
 *
 * Horizontal insets matter in landscape, where a display cutout lands on one of
 * the long edges. The rail already pays the leading one when it's up — see
 * `ShellRailContext` for why that can't be inferred from the window shape — so
 * the leading inset is skipped only in that case. The trailing edge is always
 * this screen's to pay; nothing else is over there.
 *
 * Insets sit on the root and the content gutter on the inner view, so the
 * gutter is measured from the safe edge rather than from the cutout.
 */
export function Screen({ children, style, padded = true, ...rest }: ScreenProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const railPresent = useShellRailPresent();
  // The dock claims the trailing edge, so it pays that inset — the mirror of
  // the rail taking the leading one. `sceneInsetRight` is the shell's answer.
  const sceneInsetRight = useShellLayout().sceneInsetRight;
  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top,
          paddingLeft: railPresent ? 0 : insets.left,
          paddingRight: sceneInsetRight,
        },
        style,
      ]}
      {...rest}
    >
      <View style={[styles.inner, padded && styles.padded]}>{children}</View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
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
}));

export default Screen;
