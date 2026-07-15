import {
  Alert,
  Linking,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import {
  SettingsCard,
  SettingsNavRow,
  SettingsSectionLabel,
  SettingsSectionScreen,
} from '@/components/settings/SettingsSectionScaffold';
import { Text } from '@/components/Text';
import { createBuildInfo } from '@/release/buildInfo';
import { spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';

const ASTRA_REPOSITORY_URL = 'https://github.com/Boof2015/astra-mobile';
const ASTRA_DISCORD_URL = 'https://discord.gg/hsKK8Kr9Nj';
const ASTRA_SUPPORT_URL = 'https://ko-fi.com/boof2015';
const ASTRA_PRIVACY_URL = 'https://github.com/Boof2015/astra-mobile/blob/main/PRIVACY.md';
const ASTRA_LICENSE_URL = 'https://github.com/Boof2015/astra-mobile/blob/main/LICENSE';
const GPL_V3_URL = 'https://www.gnu.org/licenses/gpl-3.0.html';

async function openExternalLink(url: string, label: string) {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Unable to open link', `Astra could not open ${label}.`);
  }
}

export default function InfoSettingsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const buildInfo = createBuildInfo(Constants.expoConfig);

  return (
    <SettingsSectionScreen title="Info">
      <SettingsSectionLabel>APP</SettingsSectionLabel>
      <SettingsCard>
        <View style={styles.infoRow}>
          <Text variant="caption" color={colors.textSecondary}>
            App Version
          </Text>
          <Text variant="body">{buildInfo.versionLabel}</Text>
        </View>
      </SettingsCard>

      <SettingsSectionLabel spaced>ATTRIBUTION</SettingsSectionLabel>
      <SettingsCard>
        <Text variant="body" style={styles.paragraph}>
          Astra is created and maintained by Boof2015.
        </Text>
        <Text variant="mono" color={colors.textSecondary}>
          contact@novaml.ai
        </Text>
      </SettingsCard>
      <SettingsNavRow
        icon="logo-github"
        title="GitHub Repository"
        subtitle="Boof2015/astra-mobile"
        rightIcon="open-outline"
        onPress={() => void openExternalLink(ASTRA_REPOSITORY_URL, 'GitHub Repository')}
      />
      <SettingsNavRow
        icon="logo-discord"
        title="Discord"
        subtitle="discord.gg/hsKK8Kr9Nj"
        rightIcon="open-outline"
        onPress={() => void openExternalLink(ASTRA_DISCORD_URL, 'Discord')}
      />
      {buildInfo.showExternalSupportLink ? (
        <SettingsNavRow
          icon="heart-outline"
          title="Ko-fi"
          subtitle="ko-fi.com/boof2015"
          rightIcon="open-outline"
          onPress={() => void openExternalLink(ASTRA_SUPPORT_URL, 'Ko-fi')}
        />
      ) : null}

      <SettingsSectionLabel spaced>PRIVACY</SettingsSectionLabel>
      <SettingsNavRow
        icon="shield-checkmark-outline"
        title="Privacy Policy"
        subtitle="How Astra handles local and optional service data"
        rightIcon="open-outline"
        onPress={() => void openExternalLink(ASTRA_PRIVACY_URL, 'the Privacy Policy')}
      />

      <SettingsSectionLabel spaced>LICENSE</SettingsSectionLabel>
      <SettingsCard>
        <Text variant="body" style={styles.paragraph}>
          Astra is distributed under GPL-3.0-only.
        </Text>
      </SettingsCard>
      <SettingsNavRow
        icon="document-text-outline"
        title="View LICENSE"
        subtitle="Repository license file"
        rightIcon="open-outline"
        onPress={() => void openExternalLink(ASTRA_LICENSE_URL, 'the Astra license')}
      />
      <SettingsNavRow
        icon="reader-outline"
        title="GPL v3 Text"
        subtitle="gnu.org/licenses/gpl-3.0.html"
        rightIcon="open-outline"
        onPress={() => void openExternalLink(GPL_V3_URL, 'GPL v3 Text')}
      />
    </SettingsSectionScreen>
  );
}

const useStyles = createThemedStyles(() => ({
  infoRow: {
    gap: spacing.xs,
  },
  paragraph: {
    lineHeight: 21,
    marginBottom: spacing.sm,
  },
}));
