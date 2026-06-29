// App entry. Loads expo-router, then registers the RNTP playback service so
// MediaSession / lock-screen / Bluetooth remote controls work even when the
// JS UI isn't mounted (headless).
import 'expo-router/entry';
import { AppRegistry } from 'react-native';
import TrackPlayer from 'react-native-track-player';
import { handleAstraCarCommand } from './src/car/carCommandService';
import { PlaybackService } from './src/audio/playbackService';

TrackPlayer.registerPlaybackService(() => PlaybackService);
AppRegistry.registerHeadlessTask('AstraCarCommand', () => handleAstraCarCommand);
