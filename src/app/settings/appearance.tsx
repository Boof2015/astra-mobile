import { AppearanceSettingsPanel } from '@/components/settings/SettingsPanels';
import { SettingsSectionScreen } from '@/components/settings/SettingsSectionScaffold';

export default function AppearanceSettingsScreen() {
  return (
    <SettingsSectionScreen title="Appearance">
      <AppearanceSettingsPanel />
    </SettingsSectionScreen>
  );
}
