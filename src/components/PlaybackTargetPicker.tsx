import { useEffect } from 'react';
import {
  Modal,
  Pressable,
  View
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useDesktopRemoteStore } from '@/stores/desktopRemoteStore';
import { usePlaybackTargetStore, type PlaybackTarget } from '@/stores/playbackTargetStore';
import { usePlayerStore } from '@/stores/playerStore';
import {
  desktopConnectionLabel,
  hostFromBaseUrl,
} from '@/playback/playbackTargetPresentation';

interface PlaybackTargetPickerProps {
  visible: boolean;
  onClose: () => void;
}

export function PlaybackTargetPicker({ visible, onClose }: PlaybackTargetPickerProps) {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const selectedTarget = usePlaybackTargetStore((s) => s.target);
  const setTarget = usePlaybackTargetStore((s) => s.setTarget);
  const phoneTrack = usePlayerStore((s) => s.currentTrack);
  const connection = useDesktopRemoteStore((s) => s.connection);
  const connectionState = useDesktopRemoteStore((s) => s.connectionState);
  const snapshot = useDesktopRemoteStore((s) => s.snapshot);
  const initDesktopRemote = useDesktopRemoteStore((s) => s.init);
  const connectDesktop = useDesktopRemoteStore((s) => s.connect);

  useEffect(() => {
    if (visible) void initDesktopRemote();
  }, [visible, initDesktopRemote]);

  const choose = (target: PlaybackTarget) => {
    void setTarget(target);
    if (target === 'desktop' && connection && connectionState !== 'connected') {
      void connectDesktop();
    }
    onClose();
  };

  const pairDesktop = () => {
    onClose();
    router.push('/desktop-remote' as never);
  };

  const desktopSubtitle = connection
    ? snapshot?.currentTrack?.title ||
      snapshot?.outputDeviceLabel?.trim() ||
      `${desktopConnectionLabel(connectionState)} · ${hostFromBaseUrl(connection.baseUrl)}`
    : 'Pair with Astra Desktop on your LAN';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.handle} />
          <Text variant="label" color={colors.textTertiary} style={styles.eyebrow}>
            OUTPUT DEVICE
          </Text>

          <TargetRow
            icon="phone-portrait-outline"
            title="This phone"
            subtitle={phoneTrack ? phoneTrack.title : 'Local playback'}
            selected={selectedTarget === 'phone'}
            onPress={() => choose('phone')}
          />

          {connection ? (
            <TargetRow
              icon="desktop-outline"
              title={connection.desktopName ?? 'Astra Desktop'}
              subtitle={desktopSubtitle}
              selected={selectedTarget === 'desktop'}
              onPress={() => choose('desktop')}
            />
          ) : (
            <TargetRow
              icon="add-circle-outline"
              title="Pair Astra Desktop"
              subtitle="Scan or enter a desktop pairing code"
              selected={false}
              onPress={pairDesktop}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TargetRow({
  icon,
  title,
  subtitle,
  selected,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <View style={[styles.iconWrap, selected && styles.iconWrapSelected]}>
        <Ionicons name={icon} size={21} color={selected ? colors.accent : colors.textSecondary} />
      </View>
      <View style={styles.rowText}>
        <Text variant="body" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {selected ? (
        <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
      ) : (
        <Ionicons name="ellipse-outline" size={22} color={colors.textTertiary} />
      )}
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.backdrop,
  },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.bgSecondary,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.textTertiary,
    marginBottom: spacing.lg,
  },
  eyebrow: {
    letterSpacing: 1.5,
    marginBottom: spacing.sm,
  },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowPressed: {
    opacity: 0.65,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgTertiary,
  },
  iconWrapSelected: {
    backgroundColor: colors.glassBg,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
}));

export default PlaybackTargetPicker;
