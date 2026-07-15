import { spawnSync } from 'node:child_process';

const TEST_SCRIPTS = [
  'test:release-config',
  'test:queue-actions',
  'test:desktop-remote',
  'test:dynamic-playlists',
  'test:album-grouping',
  'test:artist-grouping',
  'test:desktop-sync',
  'test:eq-share',
  'test:signal',
  'test:eq-math',
  'test:audio-startup',
  'test:seek-bar',
  'test:lyrics',
  'test:sleep',
  'test:troubleshooting',
  'test:settings-search',
  'test:now-playing-layout',
  'test:memory-lifecycle',
  'test:haptics',
  'test:home-greeting',
  'test:session',
];

for (const script of TEST_SCRIPTS) {
  const result = spawnSync('npm', ['run', script], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
