const { withMainActivity, withAndroidManifest, withProjectBuildGradle } = require('expo/config-plugins');

const ACTIVITY_INIT = 'expo.modules.astradiscord.DiscordPresenceManager.onActivityCreated(this)';
const SDK_REPOSITORY_MARKER = '// ASTRA DISCORD SDK REPOSITORY';
const SDK_REPOSITORY = `${SDK_REPOSITORY_MARKER}
// Register before subprojects are evaluated, including Expo's configure-on-demand builds.
def astraDiscordSdkDir = new File(System.getenv('ASTRA_DISCORD_SDK_DIR') ?: new File(rootDir, '../.local/discord-sdk').absolutePath)
if (System.getenv('ASTRA_DISCORD_ENABLED') != 'false' && new File(astraDiscordSdkDir, 'discord_partner_sdk.aar').isFile()) {
  allprojects {
    repositories {
      flatDir {
        dirs astraDiscordSdkDir
        content { includeModule('', 'discord_partner_sdk') }
      }
    }
  }
}
`;

function withAstraDiscord(config) {
  config = withProjectBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') throw new Error('Astra Discord expects a Groovy root build.gradle.');
    if (!mod.modResults.contents.includes(SDK_REPOSITORY_MARKER)) {
      const anchor = '\nallprojects {';
      if (!mod.modResults.contents.includes(anchor)) throw new Error('Could not locate root Gradle repositories for Astra Discord.');
      mod.modResults.contents = mod.modResults.contents.replace(anchor, `\n${SDK_REPOSITORY}${anchor}`);
    }
    return mod;
  });
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
