import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { TrackRow } from '@/components/library/TrackRow';
import { SignalResultCard } from '@/components/signal/SignalResultCard';
import type { SignalLocalMatchResult } from '@/audio/signalLocalMatch';
import type { DbTrack } from '@/types/library';
import type { SignalPayload } from '@boof2015/astra-signal';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';

export type SignalResultActionState = 'idle' | 'playing' | 'queueing' | 'queued';

interface SignalResolutionPanelProps {
  payload: SignalPayload;
  resolution: SignalLocalMatchResult<DbTrack> | null;
  actionState: SignalResultActionState;
  actionError: string | null;
  onPlay: (track: DbTrack) => void;
  onQueue: (track: DbTrack) => void;
  onScanAnother: () => void;
  onDone: () => void;
}

export function SignalResolutionPanel({
  payload,
  resolution,
  actionState,
  actionError,
  onPlay,
  onQueue,
  onScanAnother,
  onDone,
}: SignalResolutionPanelProps) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  const actionBusy = actionState === 'playing' || actionState === 'queueing';

  const footer = (
    <View style={styles.footerActions}>
      <Pressable
        android_ripple={ripple.bounded}
        style={styles.footerButton}
        onPress={onScanAnother}
        disabled={actionBusy}
        accessibilityRole="button"
      >
        <Ionicons name="scan-outline" size={17} color={colors.textSecondary} />
        <Text variant="label">Scan another</Text>
      </Pressable>
      <Pressable
        android_ripple={ripple.bounded}
        style={styles.footerButton}
        onPress={onDone}
        disabled={actionBusy}
        accessibilityRole="button"
      >
        <Text variant="label">Done</Text>
      </Pressable>
    </View>
  );

  if (!resolution) {
    return (
      <View style={styles.root}>
        <SignalResultCard payload={payload} compact />
        <View style={styles.statusLine}>
          <Ionicons name="library-outline" size={18} color={colors.textTertiary} />
          <Text variant="body" color={colors.textSecondary}>
            Checking your library…
          </Text>
        </View>
        {footer}
      </View>
    );
  }

  if (resolution.kind === 'none') {
    return (
      <View style={styles.root}>
        <SignalResultCard payload={payload} compact />
        <View style={styles.messageCard}>
          <Ionicons name="library-outline" size={21} color={colors.textTertiary} />
          <View style={styles.messageCopy}>
            <Text variant="heading">Not in your library</Text>
            <Text variant="label">
              The Signal decoded correctly, but no local track matched.
            </Text>
          </View>
        </View>
        {footer}
      </View>
    );
  }

  if (resolution.kind === 'ambiguous') {
    return (
      <View style={styles.root}>
        <View style={styles.sectionHeading}>
          <View style={styles.matchIcon}>
            <Ionicons name="library" size={18} color={colors.accent} />
          </View>
          <View style={styles.headingCopy}>
            <Text variant="label" color={colors.accent} style={styles.eyebrow}>
              FOUND IN YOUR LIBRARY
            </Text>
            <Text variant="heading">Choose a version</Text>
          </View>
        </View>
        <ScrollView
          style={styles.candidateList}
          nestedScrollEnabled
          showsVerticalScrollIndicator={resolution.candidates.length > 3}
        >
          {resolution.candidates.map(({ track }) => (
            <TrackRow
              key={track.path}
              track={track}
              subtitle={track.album}
              swipeToQueue={false}
              onPress={() => onPlay(track)}
            />
          ))}
        </ScrollView>
        <Text variant="caption" style={styles.centerCopy}>
          Tap a version to play it.
        </Text>
        {actionError ? (
          <Text variant="label" color={colors.warning} style={styles.centerCopy}>
            {actionError}
          </Text>
        ) : null}
        {footer}
      </View>
    );
  }

  const track = resolution.candidate.track;
  return (
    <View style={styles.root}>
      <View style={styles.sectionHeading}>
        <View style={styles.matchIcon}>
          <Ionicons name="checkmark" size={20} color={colors.accent} />
        </View>
        <View style={styles.headingCopy}>
          <Text variant="label" color={colors.accent} style={styles.eyebrow}>
            IN YOUR LIBRARY
          </Text>
          <Text variant="heading">Ready to play</Text>
        </View>
      </View>

      <TrackRow
        track={track}
        subtitle={track.album}
        swipeToQueue={false}
        onPress={() => onPlay(track)}
      />

      <View style={styles.playActions}>
        <Pressable
          android_ripple={ripple.bounded}
          style={[styles.primaryButton, actionBusy && styles.disabledButton]}
          onPress={() => onPlay(track)}
          disabled={actionBusy}
          accessibilityRole="button"
        >
          <Ionicons name="play" size={18} color={colors.accentTextStrong} />
          <Text variant="body" color={colors.accentTextStrong}>
            {actionState === 'playing' ? 'Starting…' : 'Play now'}
          </Text>
        </Pressable>
        <Pressable
          android_ripple={ripple.bounded}
          style={[styles.secondaryButton, actionBusy && styles.disabledButton]}
          onPress={() => onQueue(track)}
          disabled={actionBusy || actionState === 'queued'}
          accessibilityRole="button"
        >
          <Ionicons
            name={actionState === 'queued' ? 'checkmark' : 'list-outline'}
            size={18}
            color={colors.textPrimary}
          />
          <Text variant="body">
            {actionState === 'queueing'
              ? 'Adding…'
              : actionState === 'queued'
                ? 'Added'
                : 'Add to queue'}
          </Text>
        </Pressable>
      </View>

      {actionError ? (
        <Text variant="label" color={colors.warning} style={styles.centerCopy}>
          {actionError}
        </Text>
      ) : null}
      {footer}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  root: {
    flexShrink: 1,
    gap: spacing.md,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  matchIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentGlow,
  },
  headingCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  eyebrow: {
    letterSpacing: 0.7,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  messageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgSecondary,
  },
  messageCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  candidateList: {
    flexShrink: 1,
    maxHeight: 226,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.glassBorder,
  },
  centerCopy: {
    textAlign: 'center',
  },
  playActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  primaryButton: {
    minHeight: 48,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
  },
  secondaryButton: {
    minHeight: 48,
    flex: 1.15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgSecondary,
  },
  disabledButton: {
    opacity: 0.6,
  },
  footerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  footerButton: {
    minHeight: 40,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.sm,
  },
}));
