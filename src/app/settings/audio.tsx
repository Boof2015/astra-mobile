import { AudioSettingsPanel } from '@/components/settings/SettingsPanels';
import { SettingsSectionScreen } from '@/components/settings/SettingsSectionScaffold';

export default function AudioSettingsScreen() {
  return (
    <SettingsSectionScreen title="Audio">
      <AudioSettingsPanel />
    </SettingsSectionScreen>
  );
}
