import { Fragment, useMemo, useState } from 'react';
import {
  View,
  type LayoutChangeEvent,
} from 'react-native';
import type { TextLayoutEvent } from 'react-native/Libraries/Types/CoreEventTypes';
import { Text } from '@/components/Text';
import { TactilePressable } from '@/components/player/TactilePressable';
import { createThemedStyles } from '@/theme/themed';
import type { ArtistNameToken } from '@/shared/library/artistCredits';
import { resolveVisibleArtistCreditCount } from './artistCreditVisibility';

const MEASURE_WIDTH = 10000;

export function NowPlayingArtistCredits({
  tokens,
  lineHeight,
  onArtistPress,
  onShowAll,
}: {
  tokens: readonly ArtistNameToken[];
  lineHeight: number;
  onArtistPress: (artist: string) => void;
  onShowAll: () => void;
}) {
  const styles = useStyles();
  const [availableWidth, setAvailableWidth] = useState(0);
  const [measurements, setMeasurements] = useState<Readonly<Record<string, number>>>({});
  const signature = useMemo(
    () => JSON.stringify(tokens.map(({ artist, separator }) => [artist, separator])),
    [tokens]
  );

  const prefixWidths: Record<number, number | undefined> = {};
  const moreLabelWidths: Record<number, number | undefined> = {};
  for (let count = 1; count <= tokens.length; count += 1) {
    prefixWidths[count] = measurements[`${signature}:prefix:${count}`];
  }
  for (let count = 1; count < tokens.length; count += 1) {
    moreLabelWidths[count] = measurements[`${signature}:more:${count}`];
  }

  const visibleCount = resolveVisibleArtistCreditCount({
    artistCount: tokens.length,
    availableWidth,
    prefixWidths,
    moreLabelWidths,
  });
  const hiddenCount = tokens.length - visibleCount;

  const recordWidth = (key: string, event: TextLayoutEvent) => {
    const width = Math.ceil(event.nativeEvent.lines[0]?.width ?? 0);
    if (width <= 0) return;
    setMeasurements((current) =>
      Math.abs((current[key] ?? 0) - width) <= 1
        ? current
        : { ...current, [key]: width }
    );
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    const width = Math.ceil(event.nativeEvent.layout.width);
    setAvailableWidth((current) => (Math.abs(current - width) > 1 ? width : current));
  };

  const renderTokens = (count: number, interactive: boolean) =>
    tokens.slice(0, count).map(({ artist, separator }, index) => (
      <Fragment key={`${artist}:${index}`}>
        <Text
          variant="body"
          style={styles.artist}
          onPress={interactive ? () => onArtistPress(artist) : undefined}
          accessibilityRole={interactive ? 'link' : undefined}
          accessibilityLabel={interactive ? `View artist ${artist}` : undefined}
        >
          {artist}
        </Text>
        {separator ? (
          <Text variant="body" style={styles.artistSeparator}>
            {separator}
          </Text>
        ) : null}
      </Fragment>
    ));

  return (
    <View style={[styles.line, { height: lineHeight }]} onLayout={handleLayout}>
      <Text
        variant="body"
        numberOfLines={1}
        ellipsizeMode="tail"
        style={styles.creditText}
      >
        {renderTokens(visibleCount, true)}
      </Text>
      {hiddenCount > 0 ? (
        <TactilePressable
          hitSlop={10}
          haptic="selection"
          style={[styles.moreButton, { height: lineHeight }]}
          onPress={onShowAll}
          accessibilityRole="button"
          accessibilityLabel={`Show ${hiddenCount} more ${hiddenCount === 1 ? 'artist' : 'artists'}`}
        >
          <Text variant="body" style={styles.moreLabel}>
            +{hiddenCount} more
          </Text>
        </TactilePressable>
      ) : null}

      <View pointerEvents="none" style={styles.measureLayer}>
        {tokens.map((_, index) => {
          const count = index + 1;
          const key = `${signature}:prefix:${count}`;
          return (
            <Text
              key={key}
              variant="body"
              numberOfLines={1}
              onTextLayout={(event) => recordWidth(key, event)}
              style={styles.measure}
            >
              {renderTokens(count, false)}
            </Text>
          );
        })}
        {tokens.slice(1).map((_, index) => {
          const count = index + 1;
          const key = `${signature}:more:${count}`;
          return (
            <Text
              key={key}
              variant="body"
              numberOfLines={1}
              onTextLayout={(event) => recordWidth(key, event)}
              style={[styles.measure, styles.moreLabel]}
            >
              +{count} more
            </Text>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  line: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  creditText: {
    flexShrink: 1,
    minWidth: 0,
    textAlign: 'left',
  },
  artist: {
    color: colors.accentText,
  },
  artistSeparator: {
    color: colors.textTertiary,
  },
  moreButton: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreLabel: {
    color: colors.accentText,
  },
  measureLayer: {
    position: 'absolute',
    zIndex: -1,
  },
  measure: {
    width: MEASURE_WIDTH,
    opacity: 0,
  },
}));
