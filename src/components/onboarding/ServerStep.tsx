import { useEffect } from 'react';
import { Keyboard, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Text } from '@/components/Text';
import { ServerConnectFields } from '@/components/sources/ServerConnectFields';
import { SERVER_TYPE_OPTIONS } from '@/components/sources/ServerTypeOptions';
import { useServerConnectForm } from '@/components/sources/useServerConnectForm';
import { spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import type { RemoteSourceType } from '@/types/remote';
import { OnboardingFrame, useOnboardingNav } from './OnboardingFrame';

const TYPE_SEGMENTS = SERVER_TYPE_OPTIONS.map((option) => ({ key: option.type, label: option.label }));

/**
 * The inline connect page, a sub-page of "Your music". Connect tests and saves
 * in one go (createSource refuses to save a server it can't sign in to), names
 * the server after its host, and returns to the list with the first sync
 * already running.
 */
export function ServerStep() {
  const styles = useStyles();
  const colors = useColors();
  const nav = useOnboardingNav();
  const { setBusy, goTo } = nav;
  const form = useServerConnectForm({
    onSaved: () => {
      // The fields unmount with this page; don't leave the keyboard up over the list.
      Keyboard.dismiss();
      goTo('music');
    },
  });
  const busy = form.busy !== null;

  useEffect(() => {
    setBusy(busy);
    return () => setBusy(false);
  }, [busy, setBusy]);

  const description = SERVER_TYPE_OPTIONS.find((option) => option.type === form.type)?.description ?? '';

  return (
    <OnboardingFrame
      keyboardAware
      eyebrow="Music server"
      title="Connect a server"
      subtitle="Sign in with your server account. Your password stays on this phone."
      footer={
        <ActionButton
          style={styles.grow}
          variant="primary"
          label={busy ? 'Connecting…' : 'Connect'}
          loading={busy}
          disabled={!form.canSubmit || busy}
          onPress={() => void form.submit()}
        />
      }
    >
      <SegmentedControl
        segments={TYPE_SEGMENTS}
        value={form.type}
        onChange={(key) => form.setType(key as RemoteSourceType)}
        disabled={busy}
      />
      <Text variant="caption" color={colors.textSecondary} style={styles.help}>
        {description}
      </Text>
      <View>
        <ServerConnectFields form={form} onSubmitEditing={() => void form.submit()} />
      </View>
    </OnboardingFrame>
  );
}

const useStyles = createThemedStyles(() => ({
  grow: {
    flex: 1,
    minHeight: 52,
  },
  help: {
    marginTop: spacing.sm,
    marginHorizontal: 2,
  },
}));
