import { FlashList } from '@shopify/flash-list';
import Animated from 'react-native-reanimated';

/**
 * FlashList wrapped by Reanimated so worklet scroll handlers stay on the UI
 * thread instead of crossing through React Native's JavaScript event path.
 *
 * Preserve FlashList's generic call signature: createAnimatedComponent loses
 * it even though the runtime component forwards the same props and ref.
 */
export const ReanimatedFlashList = Animated.createAnimatedComponent(
  FlashList
) as typeof FlashList;
