import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { AppSheet, AppSheetTitle } from '@/components/sheets/AppSheet';
import { Text } from '@/components/Text';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable } from '@/components/AppPressable';
import { searchArtistImageCandidates } from '@/library/artistImageLookup';
import type { DeezerArtistCandidate } from '@/types/artistImages';

export function ArtistImageSearchSheet({
  artistName,
  onClose,
  onSelect,
}: {
  artistName: string;
  onClose: () => void;
  onSelect: (candidate: DeezerArtistCandidate) => Promise<void>;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [query, setQuery] = useState(artistName);
  const [candidates, setCandidates] = useState<DeezerArtistCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async (value = query) => {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await searchArtistImageCandidates(trimmed);
      if (result.status === 'transient_error') {
        setCandidates([]);
        setError(result.message);
      } else {
        setCandidates(result.candidates);
        if (result.candidates.length === 0) {
          setError('No artist images matched that search.');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => void search(artistName));
    // Run once with the artist name used to open this sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artistName]);

  const choose = async (candidate: DeezerArtistCandidate) => {
    if (selectedId) return;
    setSelectedId(candidate.id);
    setError(null);
    try {
      await onSelect(candidate);
      onClose();
    } catch {
      setError('That image could not be downloaded. Check your connection and try again.');
      setSelectedId(null);
    }
  };

  const openDeezerLink = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      setError('Astra could not open the Deezer link.');
    }
  };

  return (
    <AppSheet onClose={onClose} scrollable>
      <AppSheetTitle
        title="Search Deezer"
        subtitle="Choose the artist—not an album cover"
      />
      <View style={styles.searchRow}>
        <BottomSheetTextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => void search()}
          placeholder="Artist name"
          placeholderTextColor={colors.textTertiary}
          returnKeyType="search"
          autoCapitalize="words"
          style={styles.input}
          accessibilityLabel="Deezer artist search"
        />
        <AppPressable feedback="accent"

          style={styles.searchButton}
          onPress={() => void search()}
          accessibilityRole="button"
          accessibilityLabel="Search Deezer"
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.accentTextStrong} />
          ) : (
            <Ionicons name="search" size={20} color={colors.accentTextStrong} />
          )}
        </AppPressable>
      </View>

      {error ? (
        <View style={styles.message}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
          <Text variant="caption" color={colors.textSecondary} style={styles.messageText}>
            {error}
          </Text>
        </View>
      ) : null}

      <View style={styles.results}>
        {candidates.map((candidate) => (
          <View key={candidate.id} style={styles.candidate}>
            <AppPressable
              style={styles.candidateChoice}
              onPress={() => void choose(candidate)}
              accessibilityRole="button"
              accessibilityLabel={`Use Deezer image for ${candidate.name}`}
            >
              <Image
                source={{ uri: candidate.imageUrl }}
                style={styles.thumbnail}
                contentFit="cover"
                transition={100}
              />
              <View style={styles.candidateText}>
                <Text variant="body" numberOfLines={1}>{candidate.name}</Text>
                <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>
                  {formatFans(candidate.fanCount)}
                </Text>
              </View>
              {selectedId === candidate.id ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              )}
            </AppPressable>
            {candidate.linkUrl ? (
              <AppPressable
                feedback="none"
                style={styles.providerLink}
                hitSlop={8}
                onPress={() => void openDeezerLink(candidate.linkUrl!)}
                accessibilityRole="link"
                accessibilityLabel={`Open ${candidate.name} on Deezer`}
              >
                <Ionicons name="open-outline" size={17} color={colors.textSecondary} />
              </AppPressable>
            ) : null}
          </View>
        ))}
      </View>

      <AppPressable
        feedback="none"
        style={styles.attribution}
        onPress={() => void openDeezerLink('https://www.deezer.com/')}
        accessibilityRole="link"
      >
        <Text variant="caption" color={colors.textSecondary}>Images and artist data from Deezer</Text>
        <Ionicons name="open-outline" size={14} color={colors.textSecondary} />
      </AppPressable>
    </AppSheet>
  );
}

function formatFans(count: number): string {
  return `${new Intl.NumberFormat().format(count)} Deezer fans`;
}

const useStyles = createThemedStyles((colors) => ({
  searchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgTertiary,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
  },
  searchButton: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentGlow,
    overflow: 'hidden',
  },
  message: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
  },
  messageText: {
    flex: 1,
  },
  results: {
    marginTop: spacing.sm,
  },
  candidate: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.glassBorder,
  },
  candidateChoice: {
    flex: 1,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  thumbnail: {
    width: 58,
    height: 58,
    borderRadius: radius.pill,
    backgroundColor: colors.bgTertiary,
  },
  candidateText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  providerLink: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  attribution: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
}));
