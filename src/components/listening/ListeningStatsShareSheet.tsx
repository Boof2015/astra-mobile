import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { cacheDirectory, EncodingType, writeAsStringAsync } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { AppSheet, AppSheetTitle } from '@/components/sheets/AppSheet';
import { Text } from '@/components/Text';
import { listeningArtworkSource } from '@/library/artwork';
import {
  buildListeningStatsShareModel,
  type ListeningStatsShareLens,
} from '@/listeningStats/shareModel';
import { renderListeningStatsSharePng } from '@/listeningStats/shareRenderer';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import type { ListeningStatsDashboard } from '@/types/listeningStats';

const LENSES: { key: ListeningStatsShareLens; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'track', label: 'Top Track' },
  { key: 'album', label: 'Top Album' },
];

export function ListeningStatsShareSheet({
  snapshot,
  onClose,
}: {
  snapshot: ListeningStatsDashboard;
  onClose: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  const [lens, setLens] = useState<ListeningStatsShareLens>('overview');
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [rendered, setRendered] = useState<{
    key: string;
    base64: string | null;
    error: string | null;
  } | null>(null);
  const model = useMemo(() => buildListeningStatsShareModel(snapshot, lens), [lens, snapshot]);
  const renderKey = `${model.suggestedFileName}:${lens}:${colors.accent}`;
  const currentRender = rendered?.key === renderKey ? rendered : null;
  const base64 = currentRender?.base64 ?? null;
  const rendering = currentRender == null;
  const error = shareError ?? currentRender?.error ?? null;
  const artworkUris = useMemo(() => {
    const map = new Map<string, string>();
    snapshot.topTracks.forEach((item, index) => {
      const uri = listeningArtworkSource(item);
      if (uri) map.set(`track:${index + 1}`, uri);
    });
    snapshot.topArtists.forEach((item, index) => {
      const uri = listeningArtworkSource(item);
      if (uri) map.set(`artist:${index + 1}`, uri);
    });
    snapshot.topAlbums.forEach((item, index) => {
      const uri = listeningArtworkSource(item);
      if (uri) map.set(`album:${index + 1}`, uri);
    });
    return map;
  }, [snapshot]);

  useEffect(() => {
    let cancelled = false;
    void renderListeningStatsSharePng(model, {
      accentColor: colors.accent,
      artworkUris,
    }).then(
      (result) => {
        if (!cancelled) setRendered({ key: renderKey, base64: result, error: null });
      },
      (renderError) => {
        if (!cancelled) {
          setRendered({
            key: renderKey,
            base64: null,
            error: renderError instanceof Error
              ? renderError.message
              : 'The share card could not be rendered.',
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [artworkUris, colors.accent, model, renderKey]);

  const share = async () => {
    if (!base64 || !cacheDirectory) {
      setShareError('The temporary share image could not be created.');
      return;
    }
    setSharing(true);
    setShareError(null);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('No compatible sharing service is available on this device.');
      }
      const fileUri = `${cacheDirectory}${model.suggestedFileName}`;
      await writeAsStringAsync(fileUri, base64, { encoding: EncodingType.Base64 });
      await Sharing.shareAsync(fileUri, {
        mimeType: 'image/png',
        dialogTitle: 'Share Listening Stats',
        UTI: 'public.png',
      });
    } catch (shareError) {
      setShareError(
        shareError instanceof Error ? shareError.message : 'The share sheet could not be opened.',
      );
    } finally {
      setSharing(false);
    }
  };

  return (
    <AppSheet onClose={onClose} scrollable>
      <AppSheetTitle
        title="Share Listening Stats"
        subtitle="This snapshot stays frozen while you choose a card."
      />

      <View style={styles.lenses}>
        {LENSES.map((option) => {
          const disabled =
            (option.key === 'track' && snapshot.topTracks.length === 0) ||
            (option.key === 'album' && snapshot.topAlbums.length === 0);
          const selected = option.key === lens;
          return (
            <Pressable
              key={option.key}
              style={[
                styles.lens,
                selected && styles.lensSelected,
                disabled && styles.disabled,
              ]}
              android_ripple={!disabled ? ripple.bounded : undefined}
              disabled={disabled}
              onPress={() => setLens(option.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
            >
              <Text
                variant="label"
                color={selected ? colors.accentTextStrong : colors.textSecondary}
                numberOfLines={1}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.preview}>
        {base64 ? (
          <Image
            source={{ uri: `data:image/png;base64,${base64}` }}
            style={styles.previewImage}
            resizeMode="contain"
          />
        ) : (
          <View style={styles.previewLoading}>
            <Ionicons
              name={error ? 'warning-outline' : 'image-outline'}
              size={34}
              color={error ? colors.warning : colors.textTertiary}
            />
            <Text variant="label" color={error ? colors.warning : colors.textSecondary}>
              {error ?? (rendering ? 'Rendering 1474 × 1920 PNG…' : 'Preparing preview…')}
            </Text>
          </View>
        )}
      </View>

      {error && base64 ? (
        <Text variant="caption" color={colors.warning} style={styles.error}>
          {error}
        </Text>
      ) : null}

      <Pressable
        style={[styles.shareButton, (!base64 || sharing) && styles.disabled]}
        android_ripple={base64 && !sharing ? ripple.onAccent() : undefined}
        disabled={!base64 || sharing}
        onPress={() => void share()}
        accessibilityRole="button"
      >
        <Ionicons name="share-outline" size={19} color={colors.bgPrimary} />
        <Text variant="body" style={styles.shareLabel}>
          {sharing ? 'Opening share sheet…' : 'Share PNG'}
        </Text>
      </Pressable>
    </AppSheet>
  );
}

const useStyles = createThemedStyles((colors) => ({
  lenses: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginVertical: spacing.md,
    padding: 3,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  lens: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  lensSelected: {
    backgroundColor: colors.glassHighlight,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
  },
  preview: {
    width: 246,
    height: 320,
    alignSelf: 'center',
    marginVertical: spacing.sm,
    overflow: 'hidden',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgTertiary,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  error: {
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  shareButton: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    overflow: 'hidden',
  },
  shareLabel: {
    color: colors.bgPrimary,
  },
  disabled: {
    opacity: 0.45,
  },
}));
