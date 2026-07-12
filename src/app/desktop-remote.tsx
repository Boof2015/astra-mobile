import {
  useEffect,
  useMemo,
  useState
} from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AstraLogo } from '@/components/AstraLogo';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import { isWideWindow, WIDE_MIN_WIDTH } from '@/theme/adaptive';
import { useDesktopRemoteStore } from '@/stores/desktopRemoteStore';
import { usePlayerUiStore } from '@/stores/playerUiStore';
import type { DesktopRemoteDiscoveredDesktop } from '@/types/desktopRemote';

// Layout mirrors now-playing's adaptive pattern (minus the scope stage): a
// wide two-pane branch, and a portrait branch where the controls own ALL real
// leftover space (flex + space-between) so height-estimate error spreads
// between the control rows instead of pooling as one dead gap.
const MAX_CONTENT_WIDTH = 408;
const TABLET_MAX_CONTENT_WIDTH = 520;
const TABLET_ART_SIZE_MAX = 440;
const CONTENT_SIDE_PADDING = spacing.lg;
const NARROW_CONTENT_SIDE_PADDING = spacing.md;
const WIDE_MAX_CONTENT_WIDTH = 960;
const WIDE_PANE_GAP = spacing.xxl;
const WIDE_RIGHT_PANE_MIN = 300;
const WIDE_RIGHT_PANE_MAX = MAX_CONTENT_WIDTH;
const WIDE_ART_SIZE_MAX = 400;
const WIDE_ART_SIZE_MIN = 160;
const WIDE_COMPACT_HEIGHT = 480;
const MEDIA_AREA_MIN = 220;
const HEADER_HEIGHT = 32;
const CONTENT_TOP_PADDING = spacing.sm;
const CONTENT_BOTTOM_PADDING = spacing.lg;
const MEDIA_TOP_MARGIN = spacing.lg;
const MEDIA_BOTTOM_GAP = spacing.xl;
const TRACK_INFO_ESTIMATE = 96;
const SEEK_BLOCK_ESTIMATE = 54;
const PLAY_BUTTON_SIZE = 68;
const TRANSPORT_TOP_MARGIN = spacing.lg;
const SUB_BUTTON_SIZE = 40;
const SUB_TOP_MARGIN = spacing.lg;
const MIN_FLOATING_SPACE = spacing.sm;

interface RemoteLayout {
  isWide: boolean;
  contentPadding: number;
  contentWidth: number;
  leftPaneWidth: number;
  rightPaneWidth: number;
  controlsGap: number;
  artSize: number;
  mediaStackHeight: number;
  mediaTopMargin: number;
  mediaBottomGap: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getRemoteLayout(availableWidth: number, availableHeight: number): RemoteLayout {
  if (isWideWindow(availableWidth, availableHeight)) {
    const contentPadding = CONTENT_SIDE_PADDING;
    const contentWidth = Math.max(
      0,
      Math.min(availableWidth - contentPadding * 2, WIDE_MAX_CONTENT_WIDTH)
    );
    const rightPaneWidth = Math.round(
      clamp(contentWidth * 0.46, WIDE_RIGHT_PANE_MIN, WIDE_RIGHT_PANE_MAX)
    );
    const leftPaneWidth = Math.max(0, contentWidth - WIDE_PANE_GAP - rightPaneWidth);
    const verticalBudget =
      availableHeight - CONTENT_TOP_PADDING - CONTENT_BOTTOM_PADDING - HEADER_HEIGHT - spacing.md;
    const artSize = Math.round(
      clamp(Math.min(leftPaneWidth, verticalBudget), WIDE_ART_SIZE_MIN, WIDE_ART_SIZE_MAX)
    );
    return {
      isWide: true,
      contentPadding,
      contentWidth,
      leftPaneWidth,
      rightPaneWidth,
      controlsGap: availableHeight < WIDE_COMPACT_HEIGHT ? spacing.sm : spacing.lg,
      artSize,
      mediaStackHeight: artSize,
      mediaTopMargin: 0,
      mediaBottomGap: 0,
    };
  }

  // Tall windows: single column. Tablet-width ones get a larger column/art cap.
  const isTabletColumn = availableWidth >= WIDE_MIN_WIDTH;
  const contentPadding =
    availableWidth < 360 ? NARROW_CONTENT_SIDE_PADDING : CONTENT_SIDE_PADDING;
  const maxContentWidth = isTabletColumn ? TABLET_MAX_CONTENT_WIDTH : MAX_CONTENT_WIDTH;
  const contentWidth = Math.max(0, Math.min(availableWidth - contentPadding * 2, maxContentWidth));
  const mediaMax = Math.min(contentWidth, isTabletColumn ? TABLET_ART_SIZE_MAX : contentWidth);
  const mediaMin = Math.min(mediaMax, MEDIA_AREA_MIN);
  const mediaTopMargin = availableHeight < 680 ? spacing.md : MEDIA_TOP_MARGIN;
  const mediaBottomGap = availableHeight < 680 ? spacing.lg : MEDIA_BOTTOM_GAP;
  const fixedHeightBase =
    CONTENT_TOP_PADDING +
    CONTENT_BOTTOM_PADDING +
    HEADER_HEIGHT +
    mediaTopMargin +
    TRACK_INFO_ESTIMATE +
    SEEK_BLOCK_ESTIMATE +
    TRANSPORT_TOP_MARGIN +
    PLAY_BUTTON_SIZE +
    SUB_TOP_MARGIN +
    SUB_BUTTON_SIZE +
    MIN_FLOATING_SPACE;
  // The Math.max(96, ...) floor lets art shrink below MEDIA_AREA_MIN in squat
  // windows (split-screen halves) instead of pushing the controls off-screen.
  const bound = availableHeight - fixedHeightBase - mediaBottomGap;
  const artSize = Math.round(clamp(bound, Math.min(mediaMin, Math.max(96, bound)), mediaMax));
  return {
    isWide: false,
    contentPadding,
    contentWidth,
    leftPaneWidth: contentWidth,
    rightPaneWidth: contentWidth,
    controlsGap: TRANSPORT_TOP_MARGIN,
    artSize,
    mediaStackHeight: artSize,
    mediaTopMargin,
    mediaBottomGap,
  };
}

function formatPairingCountdown(expiresAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function hostFromBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function connectionLabel(state: ReturnType<typeof useDesktopRemoteStore.getState>['connectionState']): string {
  switch (state) {
    case 'connected':
      return 'Live';
    case 'connecting':
      return 'Connecting';
    case 'reconnecting':
      return 'Retrying';
    case 'pinEntry':
      return 'PIN';
    case 'pendingApproval':
      return 'Approval';
    case 'pairing':
      return 'Pairing';
    case 'error':
      return 'Offline';
    default:
      return 'Not paired';
  }
}

function DiscoveredDesktopRow({ desktop, onPair, disabled }: {
  desktop: DesktopRemoteDiscoveredDesktop;
  onPair: (desktop: DesktopRemoteDiscoveredDesktop) => void;
  disabled: boolean;
}) {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  return (
    <Pressable android_ripple={ripple.bounded}
      style={[styles.discoveredRow, disabled && styles.buttonDisabled]}
      onPress={() => onPair(desktop)}
      disabled={disabled}
    >
      <View style={styles.discoveredIcon}>
        <Ionicons name="desktop-outline" size={20} color={colors.accent} />
      </View>
      <View style={styles.discoveredText}>
        <Text variant="body" numberOfLines={1}>
          {desktop.name}
        </Text>
        <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
          {hostFromBaseUrl(desktop.baseUrl)}
        </Text>
      </View>
      <View style={styles.discoveredAction}>
        <Text variant="label" color={colors.accent}>
          Pair
        </Text>
        <Ionicons name="keypad-outline" size={17} color={colors.accent} />
      </View>
    </Pressable>
  );
}

export default function DesktopRemoteScreen() {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  const router = useRouter();
  const { pair } = useLocalSearchParams<{ pair?: string }>();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const initialized = useDesktopRemoteStore((s) => s.initialized);
  const connectionState = useDesktopRemoteStore((s) => s.connectionState);
  const connection = useDesktopRemoteStore((s) => s.connection);
  const snapshot = useDesktopRemoteStore((s) => s.snapshot);
  const discovered = useDesktopRemoteStore((s) => s.discovered);
  const discoveryAvailable = useDesktopRemoteStore((s) => s.discoveryAvailable);
  const discoveryRunning = useDesktopRemoteStore((s) => s.discoveryRunning);
  const pairing = useDesktopRemoteStore((s) => s.pairing);
  const pinPairing = useDesktopRemoteStore((s) => s.pinPairing);
  const message = useDesktopRemoteStore((s) => s.message);
  const errorMessage = useDesktopRemoteStore((s) => s.errorMessage);
  const init = useDesktopRemoteStore((s) => s.init);
  const startDiscovery = useDesktopRemoteStore((s) => s.startDiscovery);
  const stopDiscovery = useDesktopRemoteStore((s) => s.stopDiscovery);
  const requestPinPairing = useDesktopRemoteStore((s) => s.requestPinPairing);
  const confirmPinPairing = useDesktopRemoteStore((s) => s.confirmPinPairing);
  const pairFromInput = useDesktopRemoteStore((s) => s.pairFromInput);
  const pairManual = useDesktopRemoteStore((s) => s.pairManual);
  const reconnect = useDesktopRemoteStore((s) => s.reconnect);
  const forget = useDesktopRemoteStore((s) => s.forget);

  const [pairingLink, setPairingLink] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [pinClock, setPinClock] = useState(() => Date.now());
  const [manualBaseUrl, setManualBaseUrl] = useState('');
  const [manualTicket, setManualTicket] = useState('');

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    void startDiscovery();
    return () => {
      void stopDiscovery();
    };
  }, [startDiscovery, stopDiscovery]);

  useEffect(() => {
    if (typeof pair === 'string' && pair.trim()) {
      void pairFromInput(pair);
      router.setParams({ pair: undefined });
    }
  }, [pair, pairFromInput, router]);

  useEffect(() => {
    if (!pinPairing) return undefined;
    const timer = setInterval(() => setPinClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pinPairing]);

  const currentTrack = snapshot?.currentTrack ?? null;
  const isBusy = connectionState === 'pairing' || connectionState === 'pendingApproval' || connectionState === 'connecting';
  const art = currentTrack?.artworkDataUrl ?? null;
  const availableHeight = windowHeight - insets.top - insets.bottom;
  const effectiveWidth = windowWidth - insets.left - insets.right;
  const remoteLayout = getRemoteLayout(effectiveWidth, availableHeight);
  const remoteSource = connection?.desktopName ?? 'Astra Desktop';
  const remoteDetail = snapshot?.outputDeviceLabel?.trim() || (connection ? hostFromBaseUrl(connection.baseUrl) : '');
  const countdown = pairing ? formatPairingCountdown(pairing.expiresAt) : '';
  const pinPairingActive = Boolean(pinPairing && pinPairing.expiresAt > pinClock);
  const pinCountdown = pinPairing ? formatPairingCountdown(pinPairing.expiresAt, pinClock) : '';
  const normalizedPinInput = pinInput.replace(/\s+/g, '');

  const statusText = useMemo(() => {
    if (message) return message;
    if (connection) return hostFromBaseUrl(connection.baseUrl);
    if (discoveryRunning) return 'Searching for Astra Desktop on this network.';
    if (!discoveryAvailable) return 'Discovery unavailable on this device; use QR or manual pairing.';
    return 'Not paired.';
  }, [connection, discoveryAvailable, discoveryRunning, message]);

  const confirmForget = () => {
    Alert.alert('Forget desktop?', 'This removes the saved desktop pairing from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Forget', style: 'destructive', onPress: () => void forget() },
    ]);
  };

  const pairDiscovered = (desktop: DesktopRemoteDiscoveredDesktop) => {
    setPinInput('');
    setPinClock(Date.now());
    void requestPinPairing(desktop.baseUrl);
  };

  const submitPin = () => {
    void confirmPinPairing(pinInput);
  };

  const updatePinInput = (value: string) => {
    setPinInput(value.replace(/\D/g, '').slice(0, 6));
  };

  const renderSetup = () => (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <Ionicons name="phone-portrait-outline" size={30} color={colors.accent} />
        <View style={styles.heroText}>
          <Text variant="title" style={styles.heading}>
            Desktop Remote
          </Text>
          <Text variant="body" color={colors.textSecondary}>
            Pair this phone with Astra Desktop to control playback over your LAN.
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text variant="body">Nearby desktops</Text>
          {discoveryRunning || isBusy ? <ActivityIndicator color={colors.accent} /> : null}
        </View>
        <Text variant="caption" color={colors.textSecondary} style={styles.cardCopy}>
          Tap a discovered desktop, then enter the PIN shown in Astra Desktop.
        </Text>
        {discoveryAvailable ? (
          discovered.length > 0 ? (
            <View style={styles.discoveredList}>
              {discovered.map((desktop) => (
                <DiscoveredDesktopRow
                  key={desktop.endpointUuid || desktop.baseUrl}
                  desktop={desktop}
                  onPair={pairDiscovered}
                  disabled={isBusy || pinPairingActive}
                />
              ))}
            </View>
          ) : (
            <Text variant="caption" color={colors.textSecondary} style={styles.cardCopy}>
              Discovery is running. Use QR or manual pairing if this desktop does not appear.
            </Text>
          )
        ) : (
          <Text variant="caption" color={colors.textSecondary} style={styles.cardCopy}>
            Android LAN discovery is not available in this build. Use QR or manual pairing.
          </Text>
        )}
        {pinPairing ? (
          <View style={styles.pinPanel}>
            <View style={styles.pinPanelHeader}>
              <View>
                <Text variant="body">{pinPairing.desktopName || 'Astra Desktop'}</Text>
                <Text variant="caption" color={colors.textSecondary}>
                  {hostFromBaseUrl(pinPairing.baseUrl)}
                </Text>
              </View>
              <Text variant="mono" color={colors.accentText}>
                {pinCountdown}
              </Text>
            </View>
            <TextInput
              style={[styles.input, styles.pinInput]}
              value={pinInput}
              onChangeText={updatePinInput}
              placeholder="000000"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="number-pad"
              maxLength={6}
              textContentType="oneTimeCode"
            />
            <Pressable android_ripple={ripple.bounded}
              style={[
                styles.primaryButton,
                (normalizedPinInput.length !== 6 || !pinPairingActive) && styles.buttonDisabled,
              ]}
              disabled={normalizedPinInput.length !== 6 || isBusy || !pinPairingActive}
              onPress={submitPin}
            >
              <Ionicons name="checkmark" size={18} color={colors.accentTextStrong} />
              <Text variant="body" color={colors.accentTextStrong}>
                Confirm PIN
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text variant="body">Pair with QR</Text>
          {isBusy ? <ActivityIndicator color={colors.accent} /> : null}
        </View>
        <Text variant="caption" color={colors.textSecondary} style={styles.cardCopy}>
          Open Astra Desktop settings, enable Phone Remote, then scan or paste the pairing link.
        </Text>
        <View style={styles.actionRow}>
          <Pressable android_ripple={ripple.bounded} style={styles.primaryButton} onPress={() => router.push('/desktop-remote/scan' as never)}>
            <Ionicons name="scan" size={18} color={colors.accentTextStrong} />
            <Text variant="body" color={colors.accentTextStrong}>
              Scan QR
            </Text>
          </Pressable>
        </View>
        <TextInput
          style={styles.input}
          value={pairingLink}
          onChangeText={setPairingLink}
          placeholder="Paste pairing link"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Pressable android_ripple={ripple.bounded}
          style={[styles.secondaryButton, !pairingLink.trim() && styles.buttonDisabled]}
          disabled={!pairingLink.trim()}
          onPress={() => void pairFromInput(pairingLink)}
        >
          <Text variant="body" color={pairingLink.trim() ? colors.textPrimary : colors.textTertiary}>
            Pair from link
          </Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text variant="body">Manual fallback</Text>
        </View>
        <Text variant="caption" color={colors.textSecondary} style={styles.cardCopy}>
          Enter the desktop URL and pairing code from Astra Desktop.
        </Text>
        <TextInput
          style={styles.input}
          value={manualBaseUrl}
          onChangeText={setManualBaseUrl}
          placeholder="http://desktop-ip:38402"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <TextInput
          style={styles.input}
          value={manualTicket}
          onChangeText={setManualTicket}
          placeholder="Pairing code"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable android_ripple={ripple.bounded}
          style={[
            styles.secondaryButton,
            (!manualBaseUrl.trim() || !manualTicket.trim()) && styles.buttonDisabled,
          ]}
          disabled={!manualBaseUrl.trim() || !manualTicket.trim()}
          onPress={() => void pairManual(manualBaseUrl, manualTicket)}
        >
          <Text
            variant="body"
            color={manualBaseUrl.trim() && manualTicket.trim() ? colors.textPrimary : colors.textTertiary}
          >
            Pair manually
          </Text>
        </Pressable>
      </View>

      {pinPairing ? (
        <View style={styles.statusBox}>
          <Text variant="body">Enter the PIN shown on desktop</Text>
          <Text variant="mono" color={colors.accentText}>
            {pinCountdown}
          </Text>
        </View>
      ) : pairing ? (
        <View style={styles.statusBox}>
          <Text variant="body">Waiting for desktop approval</Text>
          <Text variant="mono" color={colors.accentText}>
            {countdown}
          </Text>
        </View>
      ) : null}

      {errorMessage ? (
        <Text variant="caption" color={colors.warning} style={styles.feedback}>
          {errorMessage}
        </Text>
      ) : null}
    </ScrollView>
  );

  const renderController = () => (
    <View
      style={[
        styles.remoteContent,
        {
          paddingHorizontal: remoteLayout.contentPadding,
          paddingBottom: insets.bottom + CONTENT_BOTTOM_PADDING,
        },
      ]}
    >
      <View style={[styles.remoteShell, { width: remoteLayout.contentWidth }]}>
        <View style={styles.remoteNowHeader}>
          <Pressable android_ripple={ripple.bounded} style={styles.headerBtn} onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-down" size={26} color={colors.textSecondary} />
          </Pressable>
          <View style={styles.headerMid}>
            <Text variant="caption" style={styles.eyebrow}>
              DESKTOP REMOTE
            </Text>
            <Text variant="label" numberOfLines={1} style={styles.source}>
              {remoteSource}
            </Text>
          </View>
          <Pressable android_ripple={ripple.bounded}
            style={styles.headerBtn}
            onPress={() => void reconnect()}
            hitSlop={12}
            accessibilityLabel="Reconnect to desktop"
          >
            <Ionicons name="refresh" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.managePanel}>
          <View style={styles.manageArt}>
            {art ? (
              <Image
                key={currentTrack?.id}
                source={{ uri: art }}
                style={styles.artImage}
                contentFit="cover"
              />
            ) : (
              <AstraLogo size={52} />
            )}
          </View>

          <View style={styles.manageText}>
            <Text variant="heading" numberOfLines={1} style={styles.emptyTitle}>
              {remoteSource}
            </Text>
            <Text variant="body" color={colors.textSecondary} numberOfLines={2} style={styles.centered}>
              {currentTrack
                ? `${currentTrack.title}${currentTrack.artist ? ` · ${currentTrack.artist}` : ''}`
                : remoteDetail || statusText}
            </Text>
          </View>

          <View style={styles.statusPill}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: connectionState === 'connected' ? colors.accent : colors.warning },
              ]}
            />
            <Text variant="label" color={colors.textSecondary}>
              {connectionLabel(connectionState)}
            </Text>
          </View>

          <View style={styles.manageActions}>
            <Pressable android_ripple={ripple.bounded}
              style={styles.primaryButton}
              onPress={() => {
                // The player is an overlay, not a route: open it and pop this
                // screen so it slides in above wherever the user came from.
                usePlayerUiStore.getState().openPlayer();
                if (router.canGoBack()) router.back();
                else router.replace('/');
              }}
            >
              <Ionicons name="musical-notes-outline" size={18} color={colors.accentTextStrong} />
              <Text variant="body" color={colors.accentTextStrong}>
                Open Now Playing
              </Text>
            </Pressable>
            <Pressable android_ripple={ripple.bounded} style={styles.secondaryButton} onPress={() => void reconnect()}>
              <Ionicons name="refresh" size={18} color={colors.textPrimary} />
              <Text variant="body">Reconnect</Text>
            </Pressable>
            <Pressable android_ripple={ripple.bounded} style={styles.dangerButton} onPress={confirmForget}>
              <Ionicons name="trash-outline" size={18} color={colors.warning} />
              <Text variant="body" color={colors.warning}>
                Forget desktop
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {errorMessage ? (
        <Text variant="caption" color={colors.warning} style={styles.remoteFeedback}>
          {errorMessage}
        </Text>
      ) : null}
    </View>
  );

  const showController = Boolean(connection && connectionState !== 'unpaired');

  return (
    <Screen padded={!showController}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {!initialized ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : showController ? (
          renderController()
        ) : (
          <>
            <View style={styles.topBar}>
              <Pressable android_ripple={ripple.bounded} style={styles.back} onPress={() => router.back()} hitSlop={8}>
                <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
                <Text variant="body" color={colors.textSecondary}>
                  Settings
                </Text>
              </Pressable>
            </View>
            {renderSetup()}
          </>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const useStyles = createThemedStyles((colors) => ({
  flex: {
    flex: 1,
  },
  topBar: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  content: {
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  heroText: {
    flex: 1,
  },
  heading: {
    marginBottom: spacing.xs,
  },
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardCopy: {
    lineHeight: 19,
  },
  actionRow: {
    flexDirection: 'row',
  },
  primaryButton: {
    minHeight: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgTertiary,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  dangerButton: {
    minHeight: 44,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.warning,
    backgroundColor: colors.bgTertiary,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  input: {
    minHeight: 46,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgSecondary,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
    fontSize: 15,
  },
  discoveredList: {
    gap: spacing.sm,
  },
  discoveredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 54,
  },
  discoveredIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discoveredText: {
    flex: 1,
  },
  discoveredAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pinPanel: {
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgSecondary,
    padding: spacing.md,
    gap: spacing.md,
  },
  pinPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  pinInput: {
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '700',
  },
  statusBox: {
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  feedback: {
    lineHeight: 18,
  },
  remoteContent: {
    flex: 1,
    alignItems: 'center',
    paddingTop: CONTENT_TOP_PADDING,
  },
  remoteShell: {
    flex: 1,
  },
  remoteNowHeader: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMid: {
    flex: 1,
    alignItems: 'center',
  },
  eyebrow: {
    color: colors.textTertiary,
    letterSpacing: 0,
    fontSize: 10,
  },
  source: {
    color: colors.textSecondary,
    marginTop: 1,
  },
  managePanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  manageArt: {
    width: 128,
    height: 128,
    borderRadius: radius.lg,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  manageText: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  manageActions: {
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  statusPill: {
    height: 30,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  remotePlayer: {
    flex: 1,
  },
  remotePlayerWide: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: WIDE_PANE_GAP,
  },
  middleStack: {
    width: '100%',
    alignItems: 'center',
  },
  artCard: {
    borderRadius: radius.lg,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  artImage: {
    width: '100%',
    height: '100%',
  },
  playerControls: {
    width: '100%',
  },
  // Portrait: the controls own all real leftover space; spare pixels spread
  // evenly between the rows instead of pooling above the track title.
  playerControlsFill: {
    flex: 1,
    justifyContent: 'space-between',
  },
  trackInfo: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  trackTextStack: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
  },
  trackTitle: {
    alignSelf: 'stretch',
  },
  trackTitleText: {
    textAlign: 'left',
  },
  artist: {
    color: colors.accentText,
  },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  transportMainBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transportSideBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transportSideBtnDisabled: {
    opacity: 0.35,
  },
  inlineActionBtn: {
    width: SUB_BUTTON_SIZE,
    height: SUB_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: PLAY_BUTTON_SIZE,
    height: PLAY_BUTTON_SIZE,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  subBtn: {
    width: SUB_BUTTON_SIZE,
    height: SUB_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  remoteDetail: {
    flex: 1,
    minWidth: 0,
  },
  remoteEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    textAlign: 'center',
  },
  centered: {
    textAlign: 'center',
  },
  remoteFeedback: {
    alignSelf: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: CONTENT_SIDE_PADDING,
    textAlign: 'center',
  },
}));
