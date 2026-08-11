/* eslint-disable react-hooks/refs -- HSV refs are read only by RNGH callbacks after render; keeping the gesture identity stable prevents an active color drag from being replaced mid-gesture. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import {
  Canvas,
  LinearGradient,
  Rect,
  vec,
} from '@shopify/react-native-skia';
import { AppSheet, AppSheetTitle } from '@/components/sheets/AppSheet';
import { Text } from '@/components/Text';
import { fonts, radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable } from '@/components/AppPressable';
import {
  hexToHsv,
  hsvToHex,
  normalizeHexColor,
  type HsvColor,
} from '@/theme/colorUtils';

const SV_HEIGHT = 180;
const HUE_HEIGHT = 28;
const HANDLE_SIZE = 22;
const HUE_COLORS = [
  '#ff0000',
  '#ffff00',
  '#00ff00',
  '#00ffff',
  '#0000ff',
  '#ff00ff',
  '#ff0000',
];

interface AccentColorSheetProps {
  initialHex: string;
  onPreview: (hex: string | null) => void;
  onApply: (hex: string) => void;
  onClose: () => void;
}

export function AccentColorSheet({
  initialHex,
  onPreview,
  onApply,
  onClose,
}: AccentColorSheetProps) {
  const styles = useStyles();
  const colors = useColors();
  const normalizedInitial = normalizeHexColor(initialHex) ?? '#5b8aff';
  const [hsv, setHsv] = useState<HsvColor>(() => hexToHsv(normalizedInitial));
  const hsvRef = useRef(hsv);
  const [input, setInput] = useState(normalizedInitial.toUpperCase());
  const [pickerWidth, setPickerWidth] = useState(1);
  const validInput = normalizeHexColor(input);
  const previewHex = hsvToHex(hsv.h, hsv.s, hsv.v);
  const hueColor = hsvToHex(hsv.h, 1, 1);

  useEffect(() => {
    if (validInput) onPreview(validInput);
  }, [onPreview, validInput]);

  useEffect(
    () => () => onPreview(null),
    [onPreview],
  );

  const commitHsv = useCallback((next: HsvColor) => {
    hsvRef.current = next;
    setHsv(next);
    setInput(hsvToHex(next.h, next.s, next.v).toUpperCase());
  }, []);

  const updateSv = useCallback((x: number, y: number) => {
    const next = {
      ...hsvRef.current,
      s: Math.min(1, Math.max(0, x / pickerWidth)),
      v: 1 - Math.min(1, Math.max(0, y / SV_HEIGHT)),
    };
    commitHsv(next);
  }, [commitHsv, pickerWidth]);

  const updateHue = useCallback((x: number) => {
    const next = {
      ...hsvRef.current,
      h: Math.min(359.999, Math.max(0, (x / pickerWidth) * 360)),
    };
    commitHsv(next);
  }, [commitHsv, pickerWidth]);

  const svGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .runOnJS(true)
        .onBegin((event) => updateSv(event.x, event.y))
        .onUpdate((event) => updateSv(event.x, event.y)),
    [updateSv],
  );
  const hueGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .runOnJS(true)
        .onBegin((event) => updateHue(event.x))
        .onUpdate((event) => updateHue(event.x)),
    [updateHue],
  );

  const onPickerLayout = (event: LayoutChangeEvent) => {
    setPickerWidth(Math.max(1, event.nativeEvent.layout.width));
  };

  const changeInput = (next: string) => {
    setInput(next);
    const normalized = normalizeHexColor(next);
    if (normalized) {
      const nextHsv = hexToHsv(normalized);
      hsvRef.current = nextHsv;
      setHsv(nextHsv);
    }
  };

  const apply = () => {
    if (!validInput) return;
    onApply(validInput);
    onClose();
  };

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.modalRoot}>
      <AppSheet onClose={onClose}>
      <AppSheetTitle
        title="Custom accent"
        subtitle="Drag to choose a color or enter an exact hex value."
      />

      <GestureDetector gesture={svGesture}>
        <View
          style={styles.sv}
          onLayout={onPickerLayout}
          accessibilityRole="adjustable"
          accessibilityLabel="Accent saturation and brightness"
        >
          <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Rect x={0} y={0} width={pickerWidth} height={SV_HEIGHT} color={hueColor} />
            <Rect x={0} y={0} width={pickerWidth} height={SV_HEIGHT}>
              <LinearGradient
                start={vec(0, 0)}
                end={vec(pickerWidth, 0)}
                colors={['#ffffff', '#ffffff00']}
              />
            </Rect>
            <Rect x={0} y={0} width={pickerWidth} height={SV_HEIGHT}>
              <LinearGradient
                start={vec(0, 0)}
                end={vec(0, SV_HEIGHT)}
                colors={['#00000000', '#000000']}
              />
            </Rect>
          </Canvas>
          <View
            pointerEvents="none"
            style={[
              styles.handle,
              {
                backgroundColor: previewHex,
                left: hsv.s * pickerWidth - HANDLE_SIZE / 2,
                top: (1 - hsv.v) * SV_HEIGHT - HANDLE_SIZE / 2,
              },
            ]}
          />
        </View>
      </GestureDetector>

      <GestureDetector gesture={hueGesture}>
        <View
          style={styles.hue}
          accessibilityRole="adjustable"
          accessibilityLabel="Accent hue"
        >
          <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Rect x={0} y={0} width={pickerWidth} height={HUE_HEIGHT}>
              <LinearGradient
                start={vec(0, 0)}
                end={vec(pickerWidth, 0)}
                colors={HUE_COLORS}
              />
            </Rect>
          </Canvas>
          <View
            pointerEvents="none"
            style={[
              styles.hueHandle,
              { left: (hsv.h / 360) * pickerWidth - HANDLE_SIZE / 2 },
            ]}
          />
        </View>
      </GestureDetector>

      <View style={styles.inputRow}>
        <View style={[styles.preview, { backgroundColor: validInput ?? previewHex }]} />
        <BottomSheetTextInput
          value={input}
          onChangeText={changeInput}
          placeholder="#5B8AFF"
          placeholderTextColor={colors.textTertiary}
          style={[styles.input, input.length > 0 && !validInput && styles.inputInvalid]}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          returnKeyType="done"
          selectionColor={colors.accent}
          onSubmitEditing={apply}
          accessibilityLabel="Accent hex color"
        />
      </View>
      <Text
        variant="caption"
        color={validInput ? colors.textTertiary : colors.warning}
        style={styles.validation}
      >
        {validInput ? 'Use three or six hexadecimal digits.' : 'Enter a valid hex color.'}
      </Text>

      <View style={styles.actions}>
        <AppPressable feedback="control"

          style={[styles.button, styles.cancel]}
          onPress={onClose}
        >
          <Text variant="label" color={colors.textSecondary}>Cancel</Text>
        </AppPressable>
        <AppPressable
          feedback="accent"
          style={[styles.button, styles.apply, !validInput && styles.disabled]}
          disabled={!validInput}
          onPress={apply}
        >
          <Text variant="label" color={colors.bgPrimary}>Apply</Text>
        </AppPressable>
      </View>
      </AppSheet>
      </GestureHandlerRootView>
    </Modal>
  );
}

const useStyles = createThemedStyles((colors) => ({
  modalRoot: {
    flex: 1,
  },
  sv: {
    height: SV_HEIGHT,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    marginTop: spacing.md,
  },
  hue: {
    height: HUE_HEIGHT,
    borderRadius: radius.pill,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    marginTop: spacing.md,
  },
  handle: {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    borderWidth: 3,
    borderColor: '#ffffff',
    shadowColor: '#000000',
    shadowOpacity: 0.4,
    shadowRadius: 2,
    elevation: 3,
  },
  hueHandle: {
    position: 'absolute',
    top: (HUE_HEIGHT - HANDLE_SIZE) / 2,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    borderWidth: 3,
    borderColor: '#ffffff',
    backgroundColor: 'transparent',
    elevation: 3,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  preview: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: fonts.mono.medium,
    fontSize: 17,
    letterSpacing: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgTertiary,
  },
  inputInvalid: {
    borderColor: colors.warning,
  },
  validation: {
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  button: {
    minWidth: 92,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  cancel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  apply: {
    backgroundColor: colors.accent,
  },
  disabled: {
    opacity: 0.4,
  },
}));

export default AccentColorSheet;
