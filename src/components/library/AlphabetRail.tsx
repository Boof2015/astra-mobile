/* eslint-disable react-hooks/immutability -- Reanimated shared values are mutable gesture state. */
import { useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Text } from '@/components/Text';
import { colors, radius, spacing } from '@/theme';
import { tickHaptic } from '@/lib/haptics';
import { usePullSearchGestureRef } from '@/components/search/PullSearchGesture';
import { RAIL_LETTERS } from '@/lib/letterIndex';

const CELL_HEIGHT = 17;
const RAIL_PAD = spacing.xs;
const RAIL_HEIGHT = RAIL_LETTERS.length * CELL_HEIGHT + RAIL_PAD * 2;
const BUBBLE_SIZE = 52;

interface AlphabetRailProps {
  /** Letters present in the current list — the rest render dimmed. */
  activeLetters: ReadonlySet<string>;
  onJumpToLetter: (letter: string) => void;
}

/**
 * A-Z scrubber overlaid on the right edge of a library list. Fixed cell
 * geometry (full #A-Z always rendered) keeps the pointer math trivial; one
 * haptic tick per letter crossed. The magnified letter bubble tracks the
 * finger's vertical position (Y driven on the UI thread; the letter text only
 * changes on a letter-cross). Blocks the pull-to-search gesture so a scrub at
 * scroll-top never arms the search indicator.
 */
export function AlphabetRail({ activeLetters, onJumpToLetter }: AlphabetRailProps) {
  const pullSearchRef = usePullSearchGestureRef();
  const [scrubLetter, setScrubLetter] = useState<string | null>(null);
  const lastLetter = useSharedValue('');
  // Rail's top offset inside the (vertically-centered) wrap + the finger's Y
  // within the rail, so the bubble can be placed in wrap-space.
  const railTop = useSharedValue(0);
  const bubbleY = useSharedValue(0);

  const scrubTo = (letter: string) => {
    setScrubLetter(letter);
    onJumpToLetter(letter);
  };
  const endScrub = () => setScrubLetter(null);

  const pan = useMemo(() => {
    const gesture = Gesture.Pan()
      .minDistance(0)
      .onBegin((event) => {
        'worklet';
        lastLetter.value = '';
        const y = Math.max(0, Math.min(RAIL_HEIGHT, event.y));
        bubbleY.value = railTop.value + y;
        const index = Math.max(
          0,
          Math.min(RAIL_LETTERS.length - 1, Math.floor((y - RAIL_PAD) / CELL_HEIGHT))
        );
        const letter = RAIL_LETTERS[index];
        lastLetter.value = letter;
        runOnJS(tickHaptic)();
        runOnJS(scrubTo)(letter);
      })
      .onUpdate((event) => {
        'worklet';
        const y = Math.max(0, Math.min(RAIL_HEIGHT, event.y));
        // Track the finger every frame for a smooth bubble; the letter/haptic
        // below only fire when the letter actually changes.
        bubbleY.value = railTop.value + y;
        const index = Math.max(
          0,
          Math.min(RAIL_LETTERS.length - 1, Math.floor((y - RAIL_PAD) / CELL_HEIGHT))
        );
        const letter = RAIL_LETTERS[index];
        if (letter === lastLetter.value) return;
        lastLetter.value = letter;
        runOnJS(tickHaptic)();
        runOnJS(scrubTo)(letter);
      })
      .onFinalize(() => {
        'worklet';
        lastLetter.value = '';
        runOnJS(endScrub)();
      });
    return pullSearchRef ? gesture.blocksExternalGesture(pullSearchRef) : gesture;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scrubTo/endScrub capture the latest onJumpToLetter via render closure
  }, [lastLetter, bubbleY, railTop, pullSearchRef, onJumpToLetter]);

  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bubbleY.value - BUBBLE_SIZE / 2 }],
  }));

  const onRailLayout = (e: LayoutChangeEvent) => {
    railTop.value = e.nativeEvent.layout.y;
  };

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {scrubLetter ? (
        <Animated.View style={[styles.bubble, bubbleStyle]} pointerEvents="none">
          <Text variant="mono" style={styles.bubbleLetter}>
            {scrubLetter}
          </Text>
        </Animated.View>
      ) : null}
      <GestureDetector gesture={pan}>
        <View style={styles.rail} hitSlop={{ left: 12, right: 8 }} onLayout={onRailLayout}>
          {RAIL_LETTERS.map((letter) => {
            const present = activeLetters.has(letter);
            const scrubbing = letter === scrubLetter;
            return (
              <View key={letter} style={styles.cell}>
                <Text
                  variant="mono"
                  style={[
                    styles.letter,
                    present ? styles.letterPresent : styles.letterAbsent,
                    scrubbing && styles.letterScrubbing,
                  ]}
                >
                  {letter}
                </Text>
              </View>
            );
          })}
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    // Overhang the Screen's horizontal padding so the rail hugs the true edge.
    right: -spacing.md,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  // A faint scrim strip rather than a bordered glass pill: transparent enough to
  // feel like an overlay, dark enough to keep the letters legible over bright art.
  rail: {
    width: 16,
    paddingVertical: RAIL_PAD,
    alignItems: 'center',
    backgroundColor: 'rgba(8, 10, 15, 0.35)',
    borderRadius: radius.pill,
  },
  cell: {
    height: CELL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    fontSize: 10,
    lineHeight: CELL_HEIGHT,
  },
  letterPresent: {
    color: colors.textSecondary,
  },
  letterAbsent: {
    color: colors.textTertiary,
    opacity: 0.4,
  },
  letterScrubbing: {
    color: colors.accentTextStrong,
  },
  bubble: {
    position: 'absolute',
    top: 0,
    right: 34,
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgTertiary,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  bubbleLetter: {
    fontSize: 26,
    lineHeight: 30,
    color: colors.accentTextStrong,
  },
});
