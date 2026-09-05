import { actionButtonForeground, actionButtonStyle, actionButtonTextStyle } from '@/theme/actionButtons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable } from '@/components/AppPressable';
import { useArtistImageStore } from '@/stores/artistImageStore';
import { requeueMissingArtistImages } from '@/library/artistImageLookup';

const n = (value: number) => value.toLocaleString();

/**
 * Live sweep progress, or — when idle — how many artists still have no portrait
 * plus a way to look again. The retry exists because `not_found` is terminal in
 * the pending query: without it, re-checking those artists would mean rescanning
 * the whole library.
 */
export function ArtistImageSweepStatus({ enabled }: { enabled: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const running = useArtistImageStore((s) => s.running);
  const processed = useArtistImageStore((s) => s.processed);
  const total = useArtistImageStore((s) => s.total);
  const missing = useArtistImageStore((s) => s.missing);
  const refreshMissing = useArtistImageStore((s) => s.refreshMissing);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    void refreshMissing();
  }, [refreshMissing]);

  if (!enabled) return null;

  if (running) {
    // Clamped: the denominator is counted once up front and normalizes names
    // slightly differently than the grouping does, so it can drift by a few.
    const fraction = total > 0 ? Math.min(processed / total, 1) : 0;
    return (
      <View style={styles.container}>
        <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>
          {total > 0
            ? `Looking up artist images… ${n(processed)} of ${n(total)}`
            : 'Looking up artist images…'}
        </Text>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              fraction > 0 ? { width: `${fraction * 100}%` } : styles.fillIndeterminate,
            ]}
          />
        </View>
      </View>
    );
  }

  if (missing <= 0) return null;

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await requeueMissingArtistImages();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text variant="caption" color={colors.textSecondary}>
        {missing === 1 ? '1 artist has no image' : `${n(missing)} artists have no image`}
      </Text>
      <AppPressable feedback="accent"

        style={styles.button}
        disabled={retrying}
        onPress={() => void retry()}
        accessibilityRole="button"
        accessibilityLabel="Look for missing artist images now"
      >
        {retrying ? (
          <ActivityIndicator size="small" color={actionButtonForeground(colors)} />
        ) : (
          <Ionicons name="refresh" size={16} color={actionButtonForeground(colors)} />
        )}
        <Text style={actionButtonTextStyle(colors, 'primary')} variant="label">
          Look for missing images
        </Text>
      </AppPressable>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  container: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  track: {
    height: 2,
    backgroundColor: colors.glassBorder,
    borderRadius: 1,
    overflow: 'hidden',
  },
  fill: {
    height: 2,
    backgroundColor: colors.accent,
  },
  fillIndeterminate: {
    width: '100%',
    opacity: 0.35,
  },
  button: {
    ...actionButtonStyle(colors, 'primary'),
    overflow: 'hidden',
  },
}));

export default ArtistImageSweepStatus;
