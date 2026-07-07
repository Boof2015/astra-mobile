import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRemoteSourcesStore } from '@/stores/remoteSourcesStore';
import type { RemoteSourceType } from '@/types/remote';

const TYPE_OPTIONS: {
  type: RemoteSourceType;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    type: 'subsonic',
    label: 'Subsonic',
    description: 'Navidrome, Airsonic, Gonic, and other Subsonic-compatible servers.',
    icon: 'cloud-outline',
  },
  {
    type: 'jellyfin',
    label: 'Jellyfin',
    description: 'A Jellyfin media server.',
    icon: 'tv-outline',
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
  const styles = useStyles();
  const colors = useColors();
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

export default function SourceEditScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const sources = useRemoteSourcesStore((s) => s.sources);
  const createSource = useRemoteSourcesStore((s) => s.createSource);
  const updateSource = useRemoteSourcesStore((s) => s.updateSource);
  const testSource = useRemoteSourcesStore((s) => s.testSource);

  const editing = useMemo(
    () => (id ? sources.find((s) => s.id === Number(id)) : undefined),
    [id, sources]
  );

  // Wizard: pick a server type first (new only), then enter connection details.
  const [step, setStep] = useState<'type' | 'details'>(editing ? 'details' : 'type');
  const [type, setType] = useState<RemoteSourceType>(editing?.type ?? 'subsonic');
  const [name, setName] = useState(editing?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(editing?.base_url ?? '');
  const [username, setUsername] = useState(editing?.username ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const typeLabel = type === 'subsonic' ? 'Subsonic' : 'Jellyfin';

  const canSubmit =
    name.trim().length > 0 &&
    baseUrl.trim().length > 0 &&
    username.trim().length > 0 &&
    (editing ? true : password.length > 0);

  const chooseType = (next: RemoteSourceType) => {
    setType(next);
    setMessage(null);
    setStep('details');
  };

  const goBack = () => {
    // From details on a NEW server, step back to type selection; otherwise leave.
    if (step === 'details' && !editing) {
      setMessage(null);
      setStep('type');
      return;
    }
    router.back();
  };

  const onTest = async () => {
    if (busy) return;
    if (!baseUrl.trim() || !username.trim() || !password) {
      setMessage({ text: 'Enter server URL, username, and password to test.', ok: false });
      return;
    }
    setBusy('test');
    setMessage(null);
    const result = await testSource({
      type,
      baseUrl: baseUrl.trim(),
      username: username.trim(),
      password,
    });
    setMessage({ text: result.message, ok: result.ok });
    setBusy(null);
  };

  const onSave = async () => {
    if (busy || !canSubmit) return;
    setBusy('save');
    setMessage(null);
    try {
      if (editing) {
        await updateSource(editing.id, {
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          username: username.trim(),
          password: password || undefined,
        });
      } else {
        await createSource({
          type,
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          username: username.trim(),
          password,
          enabled: true,
        });
      }
      router.back();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : String(error), ok: false });
      setBusy(null);
    }
  };

  const backLabel = step === 'details' && !editing ? 'Type' : 'Servers';

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
              Add server
            </Text>
            <Text variant="body" color={colors.textSecondary} style={styles.subheading}>
              Choose your server type to get started.
            </Text>

            <View style={styles.typeCards}>
              {TYPE_OPTIONS.map((option) => (
                <Pressable
                  key={option.type}
                  style={styles.typeCard}
                  onPress={() => chooseType(option.type)}
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
              {editing ? 'Edit server' : `${typeLabel} server`}
            </Text>

            <Field
              label="NAME"
              value={name}
              onChangeText={setName}
              placeholder={`My ${typeLabel}`}
              autoCapitalize="sentences"
            />
            <Field
              label="SERVER URL"
              value={baseUrl}
              onChangeText={setBaseUrl}
              placeholder="http://192.168.1.50:4533"
              keyboardType="url"
            />
            <Field label="USERNAME" value={username} onChangeText={setUsername} placeholder="username" />
            <Field
              label="PASSWORD"
              value={password}
              onChangeText={setPassword}
              placeholder={editing ? 'Unchanged' : 'password'}
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

            <View style={styles.actions}>
              <Pressable
                style={[styles.button, styles.secondaryButton, busy ? styles.buttonDisabled : null]}
                onPress={() => void onTest()}
                disabled={!!busy}
              >
                {busy === 'test' ? (
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : (
                  <Text variant="body" color={colors.textSecondary}>
                    Test connection
                  </Text>
                )}
              </Pressable>
              <Pressable
                style={[
                  styles.button,
                  styles.primaryButton,
                  !canSubmit || busy ? styles.buttonDisabled : null,
                ]}
                onPress={() => void onSave()}
                disabled={!canSubmit || !!busy}
              >
                {busy === 'save' ? (
                  <ActivityIndicator size="small" color={colors.accentTextStrong} />
                ) : (
                  <Text variant="body" color={colors.accentTextStrong}>
                    {editing ? 'Save' : 'Add server'}
                  </Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const useStyles = createThemedStyles((colors) => ({
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
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md + 2,
    borderRadius: radius.md,
    minHeight: 48,
  },
  secondaryButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  primaryButton: {
    backgroundColor: colors.accent,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
}));
