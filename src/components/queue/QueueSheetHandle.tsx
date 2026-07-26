import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import {
  BottomSheetHandle,
  type BottomSheetHandleProps,
} from '@gorhom/bottom-sheet';

interface QueueSheetHandleProps extends BottomSheetHandleProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  indicatorStyle?: StyleProp<ViewStyle>;
}

/**
 * Keeps the library's visual/accessibility handle while extending its gesture
 * surface across the fixed queue header rendered below it.
 */
export function QueueSheetHandle({
  children,
  style,
  indicatorStyle,
  ...handleProps
}: QueueSheetHandleProps) {
  return (
    <View>
      <BottomSheetHandle
        {...handleProps}
        style={style}
        indicatorStyle={indicatorStyle}
      />
      {children}
    </View>
  );
}
