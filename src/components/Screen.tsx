import {
  View,
  type ViewProps
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShellRailPresent } from '@/navigation/shellRailContext';
import { useShellLayout } from '@/navigation/useShellLayout';
import { ScreenTopBleedContext, useTopFadeBand } from '@/components/screenTopBleed';
import { TopFadeScrim } from '@/components/TopFadeScrim';
import { spacing } from '@/theme';
import { createThemedStyles } from '@/theme/themed';

interface ScreenProps extends ViewProps {
  /** Apply default horizontal padding. */
  padded?: boolean;
  /**
   * Let content travel behind the status bar instead of stopping below it.
   *
   * Only for screens whose scroll surface starts at the very top — Home and
   * Settings. On a screen with fixed chrome above its list (Library's switcher,
   * a back row) this would just push the chrome under the cutout, since the
   * list below it can never reach the status bar anyway.
   *
   * The scroll surface must re-pay the inset as `contentContainerStyle`
   * padding; `useScreenTopBleed` is how it learns the amount.
   */
  bleedTop?: boolean;
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
 *
 * The top inset is the exception a screen can buy out of. Paying it here is
 * what makes content stop dead at the status bar — the frame ends there, so a
 * heading scrolling up is clipped mid-glyph. `bleedTop` hands the inset to the
 * content instead, and `TopFadeScrim` washes the strip so the crossing reads as
 * a dissolve rather than a cut.
 *
 * The library detail screens bleed too, but by overriding `paddingTop` in their
 * own style rather than through this prop: they bleed so *artwork* runs behind
 * the status bar, and `CollapsingDetail` brings its own scrim and collapsed
 * bar. A `bgPrimary` wash on top of that would mute the art it exists to show.
 */
export function Screen({ children, style, padded = true, bleedTop = false, ...rest }: ScreenProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const railPresent = useShellRailPresent();
  // The dock claims the trailing edge, so it pays that inset — the mirror of
  // the rail taking the leading one. `sceneInsetRight` is the shell's answer.
  const sceneInsetRight = useShellLayout().sceneInsetRight;
  // A window too short to spend room on the fade doesn't bleed at all: content
  // stops below the bar as it always did, rather than bleeding into a bare clip.
  const fade = useTopFadeBand();
  const topBleed = bleedTop && fade ? insets.top : 0;
  return (
    <ScreenTopBleedContext.Provider value={topBleed}>
      <View
        style={[
          styles.root,
          {
            paddingTop: insets.top - topBleed,
            paddingLeft: railPresent ? 0 : insets.left,
            paddingRight: sceneInsetRight,
          },
          style,
        ]}
        {...rest}
      >
        <View style={[styles.inner, padded && styles.padded]}>{children}</View>
        {bleedTop && fade ? <TopFadeScrim band={fade} /> : null}
      </View>
    </ScreenTopBleedContext.Provider>
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
