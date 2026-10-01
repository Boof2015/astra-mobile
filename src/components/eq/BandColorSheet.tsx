import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppPressable } from '@/components/AppPressable';
import { AppSheetBody, AppSheetTitle } from '@/components/sheets/AppSheet';
import { spacing } from '@/theme';
import { createThemedStyles } from '@/theme/themed';
import { EqSheet } from './EqSheet';
import { BAND_COLOR_NAMES, useBandPalette } from './bandColors';

const SWATCH = 40;

// The custom swatch: a ring of palette dots around a center dot, reading as
// "any color". Its box is a little larger than a plain swatch so the selection
// ring sits inside it — drawn outside, the sheet's edge clipped it.
const CLUSTER_BOX = SWATCH + 8;
const CLUSTER_DOT = 10;
const CLUSTER_RADIUS = 14;
const CLUSTER_CENTER = 11;
/** The center dot grows when it is showing the band's own custom color. */
const CLUSTER_CENTER_SET = 16;
const CLUSTER_POSITIONS = Array.from({ length: 6 }, (_, i) => {
  const angle = (-90 + i * 60) * (Math.PI / 180);
  return {
    left: CLUSTER_BOX / 2 + CLUSTER_RADIUS * Math.cos(angle) - CLUSTER_DOT / 2,
    top: CLUSTER_BOX / 2 + CLUSTER_RADIUS * Math.sin(angle) - CLUSTER_DOT / 2,
  };
});

interface BandColorSheetProps {
  bandNumber: number;
  /** The band's current color: a palette slot, or a custom '#rrggbb'. */
  value: number | string | undefined;
  onSelect: (slot: number) => void;
  /** Open the free color picker (it lives at the screen root). */
  onCustom: () => void;
  onClose: () => void;
}

/** Pick a band's color: one of the palette's, or any color via the picker. */
export function BandColorSheet({ bandNumber, value, onSelect, onCustom, onClose }: BandColorSheetProps) {
  const styles = useStyles();
  const palette = useBandPalette();
  const custom = typeof value === 'string' ? value : null;
  const centerSize = custom ? CLUSTER_CENTER_SET : CLUSTER_CENTER;
  return (
    <EqSheet onClose={onClose}>
      <AppSheetTitle title={`Band ${bandNumber} color`} />
      <AppSheetBody>
        <View style={styles.grid}>
          {palette.colors.map((color, slot) => {
            const selected = slot === value;
            return (
              <View key={color} style={styles.cell}>
                <AppPressable
                  feedback="control"
                  style={[styles.swatch, { backgroundColor: color }]}
                  onPress={() => {
                    onSelect(slot);
                    onClose();
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={BAND_COLOR_NAMES[slot]}
                >
                  {selected ? <Ionicons name="checkmark" size={22} color={palette.ink} /> : null}
                </AppPressable>
              </View>
            );
          })}

          {/* Any other color, via the picker. Once the band has one, the
              center dot shows it and a ring marks it as the selection. */}
          <View style={styles.cell}>
            <AppPressable
              feedback="control"
              style={styles.cluster}
              onPress={onCustom}
              accessibilityRole="radio"
              accessibilityState={{ checked: custom !== null }}
              accessibilityLabel={custom ? `Custom color ${custom.toUpperCase()}` : 'Custom color'}
              accessibilityHint="Opens a color picker"
            >
              {custom ? <View style={[styles.clusterRing, { borderColor: custom }]} /> : null}
              {CLUSTER_POSITIONS.map((position, i) => (
                <View
                  key={i}
                  style={[styles.clusterDot, position, { backgroundColor: palette.colors[i] }]}
                />
              ))}
              <View
                style={[
                  styles.clusterDot,
                  {
                    width: centerSize,
                    height: centerSize,
                    borderRadius: centerSize / 2,
                    left: (CLUSTER_BOX - centerSize) / 2,
                    top: (CLUSTER_BOX - centerSize) / 2,
                    backgroundColor: custom ?? palette.colors[6],
                  },
                ]}
              />
            </AppPressable>
          </View>
        </View>
      </AppSheetBody>
    </EqSheet>
  );
}

const useStyles = createThemedStyles(() => ({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
    paddingBottom: spacing.md,
  },
  // Five per row: the eight palette colors and the custom swatch make 5 + 4.
  cell: {
    width: '20%',
    alignItems: 'center',
  },
  swatch: {
    width: SWATCH,
    height: SWATCH,
    borderRadius: SWATCH / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Pulled back by the extra size so its row lines up with the plain swatches.
  cluster: {
    width: CLUSTER_BOX,
    height: CLUSTER_BOX,
    marginVertical: (SWATCH - CLUSTER_BOX) / 2,
    borderRadius: CLUSTER_BOX / 2,
  },
  clusterDot: {
    position: 'absolute',
    width: CLUSTER_DOT,
    height: CLUSTER_DOT,
    borderRadius: CLUSTER_DOT / 2,
  },
  clusterRing: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: CLUSTER_BOX,
    height: CLUSTER_BOX,
    borderRadius: CLUSTER_BOX / 2,
    borderWidth: 2,
  },
}));

export default BandColorSheet;
