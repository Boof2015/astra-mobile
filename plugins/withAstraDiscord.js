const { withMainActivity, withAndroidManifest } = require('expo/config-plugins');

const ACTIVITY_INIT = 'expo.modules.astradiscord.DiscordPresenceManager.onActivityCreated(this)';

function withAstraDiscord(config) {
  config = withMainActivity(config, (mod) => {
    if (mod.modResults.language !== 'kt') throw new Error('Astra Discord expects a Kotlin MainActivity.');
    if (!mod.modResults.contents.includes(ACTIVITY_INIT)) {
      const anchor = 'super.onCreate(null)';
      if (!mod.modResults.contents.includes(anchor)) throw new Error('Could not locate Astra Activity initialization.');
      mod.modResults.contents = mod.modResults.contents.replace(anchor, `${anchor}\n    ${ACTIVITY_INIT}`);
    }
    return mod;
  });
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    for (const name of [
      'android.permission.RECORD_AUDIO',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
      'android.permission.BLUETOOTH',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.MODIFY_AUDIO_SETTINGS',
    ]) {
      const entries = manifest['uses-permission'] ??= [];
      const entry = entries.find((value) => value.$['android:name'] === name);
      if (entry) {
        entry.$['tools:node'] = 'remove';
        delete entry.$['tools:selector'];
      } else entries.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
    }
    const application = manifest.application[0];
    for (const [kind, name] of [
      ['service', 'com.discord.socialsdk.ForegroundService'],
      ['activity', 'com.discord.socialsdk.AuthenticationActivity'],
    ]) {
      const entries = application[kind] ??= [];
      const entry = entries.find((value) => value.$['android:name'] === name);
      if (entry) entry.$['tools:node'] = 'remove';
      else entries.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
    }
    return mod;
  });
}

module.exports = withAstraDiscord;
