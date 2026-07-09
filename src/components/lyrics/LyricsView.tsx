// Lyrics mode for now-playing — a lyrics-first takeover that replaces the whole
// art/controls body (and the standard header). Lyrics fill the screen over the
// blurred-art wash; a slim strip on top (dismiss · track · favorite · exit) and a
// minimal control bar below (progress + prev/play/next) stay permanently visible
// so you never lose control to go fully immersive. The ♫ toggle exits back to the
// art view; swipe-down still closes the player.

import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { MarqueeText } from '@/components/MarqueeText';
import { AstraLogo } from '@/components/AstraLogo';
import { SeekBar } from '@/components/SeekBar';
import { LyricsBand } from './LyricsBand';
import { spacing, radius } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import type { Track } from '@/types/audio';

interface LyricsViewProps {
  track: Track;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isLoading: boolean;
  isFavorite: boolean;
  onSeek: (seconds: number) => void;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onToggleFavorite: () => void;
  onExitLyrics: () => void;
  onDismiss: () => void;
}

export function LyricsView({
  track,
  currentTime,
  duration,
  isPlaying,
  isLoading,
  isFavorite,
  onSeek,
  onPlayPause,
  onNext,
  onPrev,
  onToggleFavorite,
  onExitLyrics,
  onDismiss,
}: LyricsViewProps) {
  const styles = useStyles();
  const colors = useColors();

  return (
    <View style={styles.root}>
      <View style={styles.strip}>
        <Pressable onPress={onDismiss} hitSlop={12} style={styles.stripBtn} accessibilityLabel="Close player">
          <Ionicons name="chevron-down" size={24} color={colors.textSecondary} />
        </Pressable>

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
          <Text variant="caption" numberOfLines={1} color={colors.textTertiary}>
            {track.artist}
          </Text>
        </View>

        <Pressable
          onPress={onToggleFavorite}
          hitSlop={10}
          style={styles.stripBtn}
          accessibilityLabel={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          accessibilityState={{ selected: isFavorite }}
        >
          <Ionicons
            name={isFavorite ? 'heart' : 'heart-outline'}
            size={20}
            color={isFavorite ? colors.accent : colors.textTertiary}
          />
        </Pressable>

        <Pressable
          onPress={onExitLyrics}
          hitSlop={10}
          style={styles.stripBtn}
          accessibilityLabel="Hide lyrics"
          accessibilityState={{ selected: true }}
        >
          <MaterialCommunityIcons name="script-text-outline" size={20} color={colors.accent} />
        </Pressable>
      </View>

      <LyricsBand
        track={track}
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
        onSeek={onSeek}
      />

      <View style={styles.controls}>
        <SeekBar currentTime={currentTime} duration={duration} trackKey={track.id} onSeek={onSeek} />
        <View style={styles.transport}>
          <Pressable onPress={onPrev} hitSlop={12} style={styles.transportBtn} accessibilityLabel="Previous">
            <Ionicons name="play-skip-back" size={28} color={colors.textPrimary} />
          </Pressable>
          <Pressable onPress={onPlayPause} hitSlop={12} style={styles.playButton} accessibilityLabel={isPlaying ? 'Pause' : 'Play'}>
            <Ionicons
              name={isLoading ? 'ellipsis-horizontal' : isPlaying ? 'pause' : 'play'}
              size={28}
              color={colors.bgPrimary}
            />
          </Pressable>
          <Pressable onPress={onNext} hitSlop={12} style={styles.transportBtn} accessibilityLabel="Next">
            <Ionicons name="play-skip-forward" size={28} color={colors.textPrimary} />
          </Pressable>
        </View>
      </View>
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
  stripTitle: {
    color: colors.textPrimary,
  },
  controls: {
    paddingTop: spacing.sm,
  },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    marginTop: spacing.xs,
  },
  transportBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
