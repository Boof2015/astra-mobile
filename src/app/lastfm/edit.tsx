import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import {
  colors,
  radius,
  spacing
} from '@/theme';
import { useLastFmSettingsStore } from '@/stores/lastFmSettingsStore';
import type { LastFmScrobbleProtocol } from '@/types/lastFm';

const PROTOCOL_OPTIONS: {
  protocol: LastFmScrobbleProtocol;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  urlPlaceholder: string;
  secretLabel: string;
  needsUsername: boolean;
}[] = [
  {
    protocol: 'lastfm2',
    label: 'Last.fm 2.0',
    description: 'Libre.fm, GNU FM, and other Last.fm 2.0-compatible servers.',
    icon: 'radio-outline',
    urlPlaceholder: 'https://libre.fm/2.0/',
    secretLabel: 'SESSION KEY',
    needsUsername: true,
  },
  {
    protocol: 'audioscrobbler',
    label: 'AudioScrobbler',
    description: 'Legacy AudioScrobbler 1.2 submission protocol.',
    icon: 'git-network-outline',
    urlPlaceholder: 'http://post.audioscrobbler.com/',
    secretLabel: 'PASSWORD / API KEY',
    needsUsername: true,
  },
  {
    protocol: 'listenbrainz',
    label: 'ListenBrainz',
    description: 'ListenBrainz or a compatible server. Uses an auth token.',
    icon: 'headset-outline',
    urlPlaceholder: 'https://api.listenbrainz.org',
    secretLabel: 'AUTH TOKEN',
    needsUsername: false,
  },
];

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences';
  keyboardType?: 'default' | 'url';
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  autoCapitalize = 'none',
  keyboardType = 'default',
}: FieldProps) {
  return (
    <View style={styles.field}>
      <Text variant="label" color={colors.textTertiary} style={styles.fieldLabel}>
        {label}
      </Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
      />
    </View>
  );
}

export default function LastFmEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const status = useLastFmSettingsStore((s) => s.status);
  const createCustomProfile = useLastFmSettingsStore((s) => s.createCustomProfile);
  const updateCustomProfile = useLastFmSettingsStore((s) => s.updateCustomProfile);
  const deleteCustomProfile = useLastFmSettingsStore((s) => s.deleteCustomProfile);

  const editing = useMemo(
    () => (id ? status?.profiles.find((p) => p.id === id) : undefined),
    [id, status]
  );

  // Wizard: pick a protocol first (new only), then enter destination details.
  const [step, setStep] = useState<'type' | 'details'>(editing ? 'details' : 'type');
  const [protocol, setProtocol] = useState<LastFmScrobbleProtocol>(editing?.protocol ?? 'lastfm2');
  const [name, setName] = useState(editing?.name ?? '');
  const [apiBaseUrl, setApiBaseUrl] = useState(editing?.apiBaseUrl ?? '');
  const [username, setUsername] = useState(editing?.username ?? '');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const meta = PROTOCOL_OPTIONS.find((opt) => opt.protocol === protocol) ?? PROTOCOL_OPTIONS[0];
  const canSubmit = name.trim().length > 0 && apiBaseUrl.trim().length > 0;

  const chooseProtocol = (next: LastFmScrobbleProtocol) => {
    setProtocol(next);
    setMessage(null);
    setStep('details');
  };

  const goBack = () => {
    // From details on a NEW destination, step back to protocol selection.
    if (step === 'details' && !editing) {
      setMessage(null);
      setStep('type');
      return;
    }
    router.back();
  };

  const onSave = async () => {
    if (busy || !canSubmit) return;
    setBusy(true);
    setMessage(null);
    const input = {
      protocol,
      name: name.trim(),
      apiBaseUrl: apiBaseUrl.trim(),
      username: meta.needsUsername ? username.trim() || null : null,
      sessionKey: secret.trim() || null,
    };
    const result = editing
      ? await updateCustomProfile(editing.id, input)
      : await createCustomProfile(input);
    // The service returns a status for validation failures (status.lastError set)
    // rather than throwing; a clean status (no lastError) means it saved.
    if (result && !result.lastError) {
      router.back();
      return;
    }
    setMessage({
      text: result?.lastError || 'Could not save destination.',
      ok: false,
    });
    setBusy(false);
  };

  const onRemove = () => {
    if (!editing) return;
    Alert.alert(
      `Remove ${editing.name}?`,
      'This deletes the scrobble destination and its queued scrobbles from this device. Your history on the service is unaffected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void deleteCustomProfile(editing.id);
            router.back();
          },
        },
      ]
    );
  };

  const backLabel = step === 'details' && !editing ? 'Service' : 'Scrobbling';

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Pressable style={styles.back} onPress={goBack} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
            <Text variant="body" color={colors.textSecondary}>
              {backLabel}
            </Text>
          </Pressable>
        </View>

        {step === 'type' ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <Text variant="title" style={styles.heading}>
              Add destination
            </Text>
            <Text variant="body" color={colors.textSecondary} style={styles.subheading}>
              Choose a scrobble service to get started.
            </Text>

            <View style={styles.typeCards}>
              {PROTOCOL_OPTIONS.map((option) => (
                <Pressable
                  key={option.protocol}
                  style={styles.typeCard}
                  onPress={() => chooseProtocol(option.protocol)}
                  accessibilityRole="button"
                >
                  <View style={styles.typeCardIcon}>
                    <Ionicons name={option.icon} size={24} color={colors.accent} />
                  </View>
                  <View style={styles.typeCardText}>
                    <Text variant="body">{option.label}</Text>
                    <Text
                      variant="caption"
                      color={colors.textSecondary}
                      style={styles.typeCardDesc}
                    >
                      {option.description}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                </Pressable>
              ))}
            </View>
          </ScrollView>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <Text variant="title" style={styles.heading}>
              {editing ? 'Edit destination' : `${meta.label} destination`}
            </Text>

            <Field
              label="NAME"
              value={name}
              onChangeText={setName}
              placeholder={meta.label}
              autoCapitalize="sentences"
            />
            <Field
              label="API URL"
              value={apiBaseUrl}
              onChangeText={setApiBaseUrl}
              placeholder={meta.urlPlaceholder}
              keyboardType="url"
            />
            {meta.needsUsername ? (
              <Field
                label="USERNAME"
                value={username}
                onChangeText={setUsername}
                placeholder="username"
              />
            ) : null}
            <Field
              label={meta.secretLabel}
              value={secret}
              onChangeText={setSecret}
              placeholder={editing ? 'Unchanged' : meta.secretLabel.toLowerCase()}
              secureTextEntry
            />

            {message ? (
              <Text
                variant="caption"
                color={message.ok ? colors.accent : colors.warning}
                style={styles.message}
              >
                {message.text}
              </Text>
            ) : null}

            <Pressable
              style={[styles.saveButton, !canSubmit || busy ? styles.buttonDisabled : null]}
              onPress={() => void onSave()}
              disabled={!canSubmit || busy}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.accentTextStrong} />
              ) : (
                <Text variant="body" color={colors.accentTextStrong}>
                  {editing ? 'Save' : 'Add destination'}
                </Text>
              )}
            </Pressable>

            {editing ? (
              <Pressable style={styles.removeButton} onPress={onRemove} accessibilityRole="button">
                <Ionicons name="trash-outline" size={18} color={colors.warning} />
                <Text variant="body" color={colors.warning}>
                  Remove destination
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  content: {
    paddingBottom: spacing.xxl,
  },
  heading: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  subheading: {
    marginBottom: spacing.xl,
  },
  typeCards: {
    gap: spacing.md,
  },
  typeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  typeCardIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgTertiary,
  },
  typeCardText: {
    flex: 1,
    gap: 2,
  },
  typeCardDesc: {
    lineHeight: 16,
  },
  field: {
    marginTop: spacing.lg,
  },
  fieldLabel: {
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  input: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontSize: 15,
  },
  message: {
    marginTop: spacing.lg,
    lineHeight: 18,
  },
  saveButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md + 2,
    borderRadius: radius.md,
    minHeight: 48,
    marginTop: spacing.xl,
    backgroundColor: colors.accent,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  removeButton: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
  },
});
