import { SleepTimerControls } from '@/components/player/SleepTimerControls';
import {
  SettingsCard,
  SettingsSectionLabel,
  SettingsSectionScreen,
} from '@/components/settings/SettingsSectionScaffold';

export default function PlaybackSettingsScreen() {
  return (
    <SettingsSectionScreen title="Playback">
      <SettingsSectionLabel>SLEEP TIMER</SettingsSectionLabel>
      <SettingsCard>
        <SleepTimerControls />
      </SettingsCard>
    </SettingsSectionScreen>
  );
}
