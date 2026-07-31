import { StyleSheet, View } from 'react-native';
import { SegmentedControl } from '@/components/SegmentedControl';
import { LyricsBand } from '@/components/lyrics/LyricsBand';
import { RemoteQueueSheet } from '@/components/queue/RemoteQueueSheet';
import { seekTo } from '@/audio/playbackController';
import { spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import {
  getNowPlayingTrackTransitionKey,
  NowPlayingTrackFadeThrough,
} from './nowPlayingTrackTransition';
import { usePlayerStore } from '@/stores/playerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { NowPlayingCompanion } from './nowPlayingPreferences';
import type { Track } from '@/types/audio';
import {
  AstraQueueView,
  toNativeQueuePalette,
} from '../../../modules/astra-library-scanner';

const COMPANION_SEGMENTS = [
  { key: 'queue', label: 'Queue' },
  { key: 'lyrics', label: 'Lyrics' },
];

const noop = () => {};

interface NowPlayingCompanionPaneProps {
  active: boolean;
  desktopTarget: boolean;
  track: Track | null;
}

/** Roomy-tablet companion rail. Phone sheets/takeovers remain separate. */
export function NowPlayingCompanionPane({
  active,
  desktopTarget,
  track,
}: NowPlayingCompanionPaneProps) {
  const styles = useStyles();
  const colors = useColors();
  const companion = useSettingsStore((s) => s.nowPlayingCompanion);
  const setCompanion = useSettingsStore((s) => s.setNowPlayingCompanion);
  const currentTime = usePlayerStore((s) => (active && !desktopTarget ? s.currentTime : 0));
  const duration = usePlayerStore((s) => (desktopTarget ? 0 : s.duration));
  const isPlaying = usePlayerStore(
    (s) => active && !desktopTarget && s.playbackState === 'playing'
  );
  const transitionTrackKey = getNowPlayingTrackTransitionKey(
    'phone',
    track?.path ?? null
  );

  const selectCompanion = (next: string) => {
    const value: NowPlayingCompanion = next === 'lyrics' ? 'lyrics' : 'queue';
    if (value === companion) return;
    void setCompanion(value);
  };

  return (
    <View style={styles.root}>
      {desktopTarget ? (
        <RemoteQueueSheet embedded onClose={noop} />
      ) : (
        <>
          <View style={styles.switcher}>
            <SegmentedControl
              segments={COMPANION_SEGMENTS}
              value={companion}
              onChange={selectCompanion}
            />
          </View>
          <View style={styles.content}>
            {companion === 'queue' ? (
              <AstraQueueView
                active={active}
                palette={toNativeQueuePalette(colors)}
                style={styles.nativeQueue}
              />
            ) : track ? (
              <NowPlayingTrackFadeThrough
                transitionKey={transitionTrackKey}
                style={styles.lyricsFrame}
                contentStyle={StyleSheet.absoluteFill}
              >
                <LyricsBand
                  track={track}
                  currentTime={currentTime}
                  duration={duration}
                  isPlaying={isPlaying}
                  onSeek={(seconds) => void seekTo(seconds)}
                />
              </NowPlayingTrackFadeThrough>
            ) : null}
          </View>
        </>
      )}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  root: {
    flex: 1,
    minWidth: 0,
    borderLeftColor: colors.glassBorder,
    borderLeftWidth: 1,
    paddingLeft: spacing.lg,
    overflow: 'hidden',
  },
  switcher: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.lg,
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
  lyricsFrame: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  nativeQueue: {
    flex: 1,
    minHeight: 0,
  },
}));
