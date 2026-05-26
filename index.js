// App entry. Loads expo-router, then registers the RNTP playback service so
// MediaSession / lock-screen / Bluetooth remote controls work even when the
// JS UI isn't mounted (headless).
import 'expo-router/entry';
import TrackPlayer from 'react-native-track-player';
import { PlaybackService } from './src/audio/playbackService';

TrackPlayer.registerPlaybackService(() => PlaybackService);
