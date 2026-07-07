import { LibrarySettingsPanel } from '@/components/settings/SettingsPanels';
import { SettingsSectionScreen } from '@/components/settings/SettingsSectionScaffold';

export default function LibrarySettingsScreen() {
  return (
    <SettingsSectionScreen title="Library">
      <LibrarySettingsPanel />
    </SettingsSectionScreen>
  );
}
