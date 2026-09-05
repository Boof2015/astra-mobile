/* eslint-disable react-hooks/immutability -- Reanimated shared values are mutable gesture state. */
import { useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Text } from '@/components/Text';
import { radius, spacing } from '@/theme';
import { createThemedStyles } from '@/theme/themed';
import { rgbaFromHex } from '@/theme/colorUtils';
import { playHaptic } from '@/lib/haptics';
import { usePullSearchGestureRef } from '@/components/search/PullSearchGesture';
import { railLettersForDirection } from '@/lib/letterIndex';
import type { SortDirection } from '@/lib/sortDirection';
import {
  ALPHABET_LETTER_LINE_HEIGHT,
  alphabetRailIndexAt,
  getAlphabetRailLayout,
} from './alphabetRailLayout';
const BUBBLE_SIZE = 52;

interface AlphabetRailProps {
  /** Letters present in the current list — the rest render dimmed. */
  activeLetters: ReadonlySet<string>;
  direction: SortDirection;
  onJumpToLetter: (letter: string) => void;
  /**
   * Fired when the finger lifts. The screen debounces `onJumpToLetter` so a fast
   * scrub does not rebuild the list once per letter crossed; this is its cue to
   * commit the last letter immediately instead of waiting out the debounce.
   */
  onScrubEnd?: () => void;
}

/**
 * A-Z scrubber overlaid on the right edge of a library list. Short viewports
 * show intermediate letters as dots; every letter remains reachable by scrubbing.
 * One haptic tick per letter crossed. The magnified letter bubble tracks the
 * finger's vertical position (Y driven on the UI thread; the letter text only
 * changes on a letter-cross). Blocks the pull-to-search gesture so a scrub at
 * scroll-top never arms the search indicator.
 */
export function AlphabetRail({
  activeLetters,
  direction,
  onJumpToLetter,
  onScrubEnd,
}: AlphabetRailProps) {
  const styles = useStyles();
  const pullSearchRef = usePullSearchGestureRef();
  const [scrubLetter, setScrubLetter] = useState<string | null>(null);
  const [availableHeight, setAvailableHeight] = useState(0);
  const { fontScale } = useWindowDimensions();
  const layout = useMemo(
    () => getAlphabetRailLayout(availableHeight, fontScale),
    [availableHeight, fontScale],
  );
  const railLetters = railLettersForDirection(direction);
  const lastLetter = useSharedValue('');
  // Rail's top offset inside the (vertically-centered) wrap + the finger's Y
  // within the rail, so the bubble can be placed in wrap-space.
  const railTop = useSharedValue(0);
  const bubbleY = useSharedValue(0);

  const scrubTo = (letter: string) => {
    if (!activeLetters.has(letter)) {
      setScrubLetter(null);
      return;
    }
    setScrubLetter(letter);
    playHaptic('frequentStep');
    onJumpToLetter(letter);
  };
  const endScrub = () => {
    setScrubLetter(null);
    onScrubEnd?.();
  };

  const pan = useMemo(() => {
    const gesture = Gesture.Pan()
      .enabled(layout !== null)
      .minDistance(0)
      .onBegin((event) => {
        'worklet';
        if (!layout) return;
        lastLetter.value = '';
        const y = Math.max(0, Math.min(layout.height, event.y));
        bubbleY.value = railTop.value + y;
        const index = alphabetRailIndexAt(y, layout);
        const letter = railLetters[index];
        lastLetter.value = letter;
        runOnJS(scrubTo)(letter);
      })
      .onUpdate((event) => {
        'worklet';
        if (!layout) return;
        const y = Math.max(0, Math.min(layout.height, event.y));
        // Track the finger every frame for a smooth bubble; the letter/haptic
        // below only fire when the letter actually changes.
        bubbleY.value = railTop.value + y;
        const index = alphabetRailIndexAt(y, layout);
        const letter = railLetters[index];
        if (letter === lastLetter.value) return;
        lastLetter.value = letter;
        runOnJS(scrubTo)(letter);
      })
      .onFinalize(() => {
        'worklet';
        lastLetter.value = '';
        runOnJS(endScrub)();
      });
    return pullSearchRef ? gesture.blocksExternalGesture(pullSearchRef) : gesture;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scrubTo/endScrub capture the latest props via render closure
  }, [layout, lastLetter, bubbleY, railTop, pullSearchRef, activeLetters, railLetters, onJumpToLetter, onScrubEnd]);

  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(0, Math.min(
      availableHeight - BUBBLE_SIZE,
      bubbleY.value - BUBBLE_SIZE / 2,
    )) }],
  }));

  const onRailLayout = (e: LayoutChangeEvent) => {
    railTop.value = e.nativeEvent.layout.y;
  };

  return (
    <View
      style={styles.wrap}
      pointerEvents="box-none"
      onLayout={(event) => setAvailableHeight(event.nativeEvent.layout.height)}
    >
      {layout && scrubLetter ? (
        <Animated.View style={[styles.bubble, bubbleStyle]} pointerEvents="none">
          <Text variant="mono" style={styles.bubbleLetter}>
            {scrubLetter}
          </Text>
        </Animated.View>
      ) : null}
      {layout ? (
        <GestureDetector gesture={pan}>
          <View style={[styles.rail, { height: layout.height }]} hitSlop={{ left: 12, right: 8 }} onLayout={onRailLayout}>
            {railLetters.map((letter, index) => {
              const present = activeLetters.has(letter);
              const scrubbing = letter === scrubLetter;
              return (
                <View
                  key={letter}
                  style={[
                    styles.cell,
                    {
                      top: layout.firstCenter + index * layout.step - layout.labelHeight / 2,
                      height: layout.labelHeight,
                    },
                  ]}
                >
                  {layout.labelIndices.includes(index) ? (
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
                  ) : (
                    <View
                      style={[
                        styles.dot,
                        !present && styles.dotAbsent,
                        scrubbing && styles.dotScrubbing,
                      ]}
                    />
                  )}
                </View>
              );
            })}
          </View>
        </GestureDetector>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
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
    alignItems: 'center',
    backgroundColor: rgbaFromHex(colors.bgPrimary, 0.35),
    borderRadius: radius.pill,
  },
  cell: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    fontSize: 10,
    lineHeight: ALPHABET_LETTER_LINE_HEIGHT,
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
  dot: {
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.textSecondary,
  },
  dotAbsent: {
    backgroundColor: colors.textTertiary,
    opacity: 0.4,
  },
  dotScrubbing: {
    backgroundColor: colors.accentTextStrong,
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
}));
