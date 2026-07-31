import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { NowPlayingOverlay } from '@/components/player/NowPlayingOverlay';
import { spacing } from '@/theme';
import { createThemedStyles } from '@/theme/themed';
import { useShellLayout } from '@/navigation/useShellLayout';
import { useSettingsStore } from '@/stores/settingsStore';
import { motion } from '@/theme/motion';

/**
 * The persistent side-by-side player pane (tablet stage B).
 *
 * Mounted at root beside the Stack, so the pane survives every route —
 * settings sub-pages and the other root-stack screens are pushed *above* the
 * tabs navigator and would otherwise make a ~400dp pane vanish and reappear.
 * `NowPlayingHost` is a sibling *after* it, so the fullscreen player still
 * covers the dock rather than fighting it.
 *
 * Landscape tablets only: `getShellLayout` requires a landscape window, enough
 * height to be worth a player column, and a usable scene behind it. Portrait
 * keeps the fullscreen overlay, and phones never see it.
 *
 * The body is the real player — `NowPlayingOverlay` with `presentation="dock"`,
 * which swaps its container and drops the dismiss gesture but shares every bit
 * of geometry, because a dock column is portrait-shaped and that is exactly
 * what the standard layout branch already solves.
 */
export function PlayerDock() {
  const styles = useStyles();
  const shell = useShellLayout();

  // The pane SLIDES rather than growing.
  //
  // Animating its layout width looked right on paper — the scene is `flex: 1`,
  // so it would narrow continuously — but it re-measured the whole navigator
  // and its FlashList every frame, and worse, `shell` recomputes from `docked`
  // instantly (window dimensions don't change mid-animation), so the nav card
  // was laid out for the final column on frame one and then fought the
  // container all the way there. Two sources of truth disagreeing for 220ms.
  //
  // So the pane claims its width in one layout pass and travels in on a
  // transform, which never touches layout. The scene reflows exactly once, at
  // the start of the open, and everything after that is on the UI thread.
  // Two different questions, and conflating them is what made the close jump:
  // `wantDock` is what the user just asked for and drives the slide; the
  // shell's `docked` is whether the pane still holds its column, and it lags
  // behind by the length of that slide — so this stays mounted, and the scene
  // stays narrow, until the pane is genuinely gone.
  const wantDock = useSettingsStore((s) => s.playerDockOpen);
  const paneWidth = shell.dockCandidateWidth;
  const offset = useSharedValue(wantDock ? 0 : paneWidth);

  useEffect(() => {
    offset.value = withTiming(wantDock ? 0 : paneWidth, motion.snap);
  }, [wantDock, paneWidth, offset]);

  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  if (!shell.docked) return null;

  return (
    <Animated.View style={[styles.dock, { width: paneWidth }, slideStyle]}>
      <View style={{ width: paneWidth, flex: 1 }}>
      <NowPlayingOverlay presentation="dock" dockWidth={paneWidth} />
      </View>
    </Animated.View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  dock: {
    // Clips the fixed-width content while the container's width animates.
    overflow: 'hidden',
    backgroundColor: colors.bgPrimary,
    borderLeftColor: colors.glassBorder,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  header: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    zIndex: 2,
  },
  headerButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));

export default PlayerDock;
