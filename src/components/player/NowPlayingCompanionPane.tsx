import { StyleSheet, View } from 'react-native';
import { LyricsBand } from '@/components/lyrics/LyricsBand';
import { RemoteQueueSheet } from '@/components/queue/RemoteQueueSheet';
import { seekTo } from '@/audio/playbackController';
import { createThemedStyles, useColors } from '@/theme/themed';
import {
  getNowPlayingTrackTransitionKey,
  NowPlayingTrackFadeThrough,
} from './nowPlayingTrackTransition';
import { usePlayerStore } from '@/stores/playerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { Track } from '@/types/audio';
import {
  AstraQueueView,
  toNativeQueuePalette,
} from '../../../modules/astra-library-scanner';

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
  const currentTime = usePlayerStore((s) => (active && !desktopTarget ? s.currentTime : 0));
  const duration = usePlayerStore((s) => (desktopTarget ? 0 : s.duration));
  const isPlaying = usePlayerStore(
    (s) => active && !desktopTarget && s.playbackState === 'playing'
  );
  const transitionTrackKey = getNowPlayingTrackTransitionKey(
    'phone',
    track?.path ?? null
  );

  return (
    <View style={styles.root}>
      {desktopTarget ? (
        <RemoteQueueSheet embedded onClose={noop} />
      ) : (
        <View style={styles.content}>
          {companion === 'queue' ? (
            <AstraQueueView
              active={active}
              paneMode
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
                surface="panel"
                onSeek={(seconds) => void seekTo(seconds)}
              />
            </NowPlayingTrackFadeThrough>
          ) : null}
        </View>
      )}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  root: {
    // No border and no card: the pane is a region of the same surface as the
    // player, separated by the gap the layout already reserves. A rule down the
    // middle plus a bordered slab was two frames around one thing.
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
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
