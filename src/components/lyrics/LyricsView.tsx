// Phone lyrics takeover. The compact track header stays; the shared lyrics
// toggle belongs to the player shell so its position never changes with mode.

import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { MarqueeText } from '@/components/MarqueeText';
import { AstraLogo } from '@/components/AstraLogo';
import {
  getNowPlayingTrackTransitionKey,
  NowPlayingTrackFadeThrough,
} from '@/components/player/nowPlayingTrackTransition';
import { LyricsBand } from './LyricsBand';
import { spacing, radius } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable } from '@/components/AppPressable';
import { usePlayerStore } from '@/stores/playerStore';
import { useLyricsStore } from '@/stores/lyricsStore';
import { getLyricsPayloadSourceLabel } from '@/lyrics/presentation';
import type { Track } from '@/types/audio';

interface LyricsViewProps {
  track: Track;
  /** False while mounted but hidden (closed now-playing overlay): pins progress, stops rAF loops. */
  active?: boolean;
  isPlaying: boolean;
  onSeek: (seconds: number) => void;
  onDismiss: () => void;
}

export function LyricsView({
  track,
  active = true,
  isPlaying,
  onSeek,
  onDismiss,
}: LyricsViewProps) {
  const styles = useStyles();
  const colors = useColors();
  // Lyrics mode is phone-target only, so progress comes straight from the
  // player store — the 2Hz tick re-renders this takeover, not the whole screen.
  // While inactive the selector pins to 0 so hidden ticks don't re-render.
  const currentTime = usePlayerStore((s) => (active ? s.currentTime : 0));
  const duration = usePlayerStore((s) => s.duration);
  const result = useLyricsStore((s) => s.byPath[track.path]?.result ?? null);
  const sourceLabel = result?.status === 'hit' ? getLyricsPayloadSourceLabel(result.lyrics) : null;
  const transitionTrackKey = getNowPlayingTrackTransitionKey('phone', track.path);

  return (
    <View style={styles.root}>
      <View style={styles.strip}>
        <AppPressable feedback="control"  onPress={onDismiss} hitSlop={12} style={styles.stripBtn} accessibilityLabel="Close player">
          <Ionicons name="chevron-down" size={24} color={colors.textSecondary} />
        </AppPressable>

        <View style={styles.stripTrackFrame}>
          <NowPlayingTrackFadeThrough
            transitionKey={transitionTrackKey}
            style={StyleSheet.absoluteFill}
            contentStyle={styles.stripTrack}
          >
            <View style={styles.thumb}>
              {track.artworkData ? (
                <Image source={{ uri: track.artworkData }} style={styles.thumbImage} contentFit="cover" />
              ) : (
                <AstraLogo size={18} />
              )}
            </View>

            <View style={styles.stripText}>
              <MarqueeText variant="label" style={styles.stripTitle}>
                {track.title}
              </MarqueeText>
              <View style={styles.stripSubRow}>
                <Text variant="caption" numberOfLines={1} color={colors.textSecondary} style={styles.stripArtist}>
                  {track.artist}
                </Text>
                {sourceLabel ? (
                  <Text variant="mono" numberOfLines={1} color={colors.textSecondary} style={styles.sourceTag}>
                    {sourceLabel}
                  </Text>
                ) : null}
              </View>
            </View>
          </NowPlayingTrackFadeThrough>
        </View>
      </View>

      <NowPlayingTrackFadeThrough
        transitionKey={transitionTrackKey}
        style={styles.lyricsFrame}
        contentStyle={StyleSheet.absoluteFill}
      >
        <LyricsBand
          track={track}
          currentTime={currentTime}
          duration={duration}
          isPlaying={isPlaying && active}
          onSeek={onSeek}
        />
      </NowPlayingTrackFadeThrough>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  root: {
    flex: 1,
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  stripBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stripTrackFrame: {
    flex: 1,
    height: 40,
    position: 'relative',
  },
  stripTrack: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImage: {
    width: 40,
    height: 40,
  },
  stripText: {
    flex: 1,
    minWidth: 0,
  },
  lyricsFrame: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  stripTitle: {
    color: colors.textPrimary,
  },
  stripSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  stripArtist: {
    flexShrink: 1,
  },
  sourceTag: {
    flexShrink: 0,
    fontSize: 9,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
}));
