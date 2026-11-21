import { ActionButton } from '@/components/ActionButton';
import { KeyboardAvoidingArea } from '@/components/KeyboardAvoidingArea';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { useSceneBottomInset } from '@/navigation/useShellLayout';
import { Text } from '@/components/Text';
import { spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable } from '@/components/AppPressable';
import { useRemoteSourcesStore } from '@/stores/remoteSourcesStore';
import { ServerConnectFields } from '@/components/sources/ServerConnectFields';
import { ServerTypeOptions, serverTypeLabel } from '@/components/sources/ServerTypeOptions';
import { useServerConnectForm } from '@/components/sources/useServerConnectForm';
import type { RemoteSourceRow, RemoteSourceType } from '@/types/remote';

/**
 * Settings › Servers add/edit. A thin host around the shared connect form:
 * new servers pick a type first, then fill the form; editing goes straight to it.
 */
export default function SourceEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = useRemoteSourcesStore((s) => (id ? s.sources.find((source) => source.id === Number(id)) : undefined));
  const [type, setType] = useState<RemoteSourceType | null>(null);
  const router = useRouter();

  // The row can land after the first render; keying the form by it means the
  // fields are seeded from the real row rather than from an empty first pass.
  if (id && !editing) {
    return (
      <Screen bleedBottom>
        <BackHeader label="Servers" onPress={() => router.back()} />
      </Screen>
    );
  }
  if (!editing && type === null) return <TypeStep onChoose={setType} />;
  return (
    <DetailsStep
      key={editing?.id ?? type ?? 'new'}
      type={editing?.type ?? type ?? 'subsonic'}
      source={editing}
      onBackToType={editing ? undefined : () => setType(null)}
    />
  );
}

function TypeStep({ onChoose }: { onChoose: (type: RemoteSourceType) => void }) {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const sceneBottomInset = useSceneBottomInset();
  return (
    <Screen bleedBottom>
      <BackHeader label="Servers" onPress={() => router.back()} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xxl + sceneBottomInset }}>
        <Text variant="title" style={styles.heading}>
          Add server
        </Text>
        <Text variant="body" color={colors.textSecondary} style={styles.subheading}>
          Choose your server type to get started.
        </Text>
        <ServerTypeOptions onChoose={onChoose} />
      </ScrollView>
    </Screen>
  );
}

function DetailsStep({
  type,
  source,
  onBackToType,
}: {
  type: RemoteSourceType;
  source?: RemoteSourceRow;
  onBackToType?: () => void;
}) {
  const styles = useStyles();
  const router = useRouter();
  const sceneBottomInset = useSceneBottomInset();
  const form = useServerConnectForm({ initialType: type, source, onSaved: () => router.back() });

  return (
    <Screen bleedBottom>
      <KeyboardAvoidingArea style={styles.flex}>
        <BackHeader
          label={onBackToType ? 'Type' : 'Servers'}
          onPress={() => {
            if (form.busy) return;
            if (onBackToType) onBackToType();
            else router.back();
          }}
        />
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: spacing.xxl + sceneBottomInset }}
          keyboardShouldPersistTaps="handled"
        >
          <Text variant="title" style={styles.heading}>
            {source ? 'Edit server' : `${serverTypeLabel(type)} server`}
          </Text>
          <ServerConnectFields form={form} showName onSubmitEditing={() => void form.submit()} />
          <View style={styles.actions}>
            <ActionButton
              style={styles.button}
              onPress={() => void form.test()}
              disabled={form.busy !== null || !form.ready}
              variant="secondary"
              label="Test connection"
              loading={form.busy === 'test'}
            />
            <ActionButton
              style={styles.button}
              onPress={() => void form.submit()}
              disabled={!form.canSubmit || form.busy !== null}
              variant="primary"
              label={source ? 'Save' : 'Add server'}
              loading={form.busy === 'save'}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingArea>
    </Screen>
  );
}

function BackHeader({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.header}>
      <AppPressable feedback="control" style={styles.back} onPress={onPress} hitSlop={8}>
        <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        <Text variant="body" color={colors.textSecondary}>
          {label}
        </Text>
      </AppPressable>
    </View>
  );
}

const useStyles = createThemedStyles(() => ({
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
  heading: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  subheading: {
    marginBottom: spacing.xl,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  button: {
    flex: 1,
  },
}));
