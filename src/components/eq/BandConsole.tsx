import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { HapticSwitch } from '@/components/HapticSwitch';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable, SCROLL_PRESS_DELAY } from '@/components/AppPressable';
import {
  EQ_MAX_GAIN_DB,
  isPassEQBandType,
  isShelfEQBandType,
} from '@/audio/eq';
import type { EQBand } from '@/types/audio';
import { VerticalEQSlider } from './VerticalEQSlider';
import { CONSOLE_ADD_WIDTH } from './eqLayout';
import type { EQEditableValue } from './BandDetailPanel';
import {
  BAND_TYPE_LABEL,
  formatFreq,
  formatGain,
  gainColor,
} from './format';

interface BandConsoleProps {
  bands: EQBand[];
  activeBandId: string | null;
  canAdd: boolean;
  stripWidth: number;
  railHeight: number;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onUpdate: (id: string, updates: Partial<EQBand>) => void;
  onEditType: (id: string) => void;
  onEditValue: (id: string, value: EQEditableValue) => void;
}

/**
 * The wide-window band editor: one vertical strip per band, in array order.
 *
 * This is `BandStrip` and `BandDetailPanel` welded back together. The phone
 * splits one band across two components because it cannot show them at once —
 * the chip carries frequency and gain, the panel below carries everything else
 * for whichever chip you tapped. Given width, a strip carries the whole band,
 * and every band's values are readable without selecting anything.
 *
 * Horizontal, not a table, because the graph directly above it is a function of
 * frequency: a top-to-bottom list would fight the axis it belongs to. Strips
 * stay in **array order** rather than sorted by frequency — dragging a node past
 * its neighbour must never slide a control out from under your finger, and the
 * band number carries the correspondence to the curve instead.
 *
 * Gain is a rail rather than a horizontal slider so the console shares its shape
 * with the graphic-mode panel, which is already a row of `VerticalEQSlider`s.
 * Frequency is dragged on the graph; frequency and Q are tap-to-edit here, which
 * opens the same sheets the detail panel opens.
 */
export function BandConsole({
  bands,
  activeBandId,
  canAdd,
  stripWidth,
  railHeight,
  onSelect,
  onAdd,
  onUpdate,
  onEditType,
  onEditValue,
}: BandConsoleProps) {
  const styles = useStyles();
  const colors = useColors();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
    >
      {bands.map((band, index) => {
        const isActive = band.id === activeBandId;
        const isPass = isPassEQBandType(band.type);
        const isShelf = isShelfEQBandType(band.type);
        return (
          <AppPressable
            key={band.id}

            unstable_pressDelay={SCROLL_PRESS_DELAY}
            style={[styles.strip, { width: stripWidth }, isActive && styles.stripActive]}
            // Selecting a band highlights its node on the curve. The strip is
            // the whole target, the way the chip is on a phone; the controls
            // inside it take precedence where they overlap.
            onPress={() => onSelect(band.id)}
            accessibilityLabel={`Band ${index + 1}`}
          >
            <View style={styles.header}>
              <Text variant="label" color={isActive ? colors.accentText : colors.textSecondary}>
                {index + 1}
              </Text>
              <HapticSwitch
                value={band.enabled}
                onValueChange={(enabled) => onUpdate(band.id, { enabled })}
                trackColor={{ false: colors.glassBorder, true: colors.accent }}
                thumbColor={colors.textPrimary}
              />
            </View>

            <AppPressable feedback="control"

              unstable_pressDelay={SCROLL_PRESS_DELAY}
              style={styles.typeButton}
              onPress={() => onEditType(band.id)}
              accessibilityRole="button"
              accessibilityLabel={`Band ${index + 1} filter type, ${BAND_TYPE_LABEL[band.type]}`}
            >
              <Text variant="caption" color={colors.textPrimary} numberOfLines={1}>
                {BAND_TYPE_LABEL[band.type]}
              </Text>
              <Ionicons name="chevron-down" size={12} color={colors.textSecondary} />
            </AppPressable>

            {/*
              A pass filter has no gain to set. Keeping the rail in place rather
              than collapsing it holds every strip's readouts on the same line —
              a console whose rows drift by band type is unreadable at a glance.
            */}
            <View
              style={[styles.rail, { height: railHeight }, isPass && styles.railDisabled]}
              pointerEvents={isPass ? 'none' : 'auto'}
              onTouchStart={() => {
                if (!isActive) onSelect(band.id);
              }}
            >
              <VerticalEQSlider
                label={`Band ${index + 1} gain`}
                value={isPass ? 0 : band.gain}
                min={-EQ_MAX_GAIN_DB}
                max={EQ_MAX_GAIN_DB}
                onChange={(gain) => onUpdate(band.id, { gain })}
              />
            </View>

            <Readout
              label="dB"
              value={isPass ? '—' : formatGain(band.gain)}
              emphasis
              color={band.enabled && !isPass ? gainColor(band.gain, colors) : colors.textTertiary}
              onPress={isPass ? undefined : () => onEditValue(band.id, 'gain')}
            />
            <Readout
              label="Hz"
              value={formatFreq(band.frequency)}
              onPress={() => onEditValue(band.id, 'frequency')}
            />
            <Readout
              label="Q"
              value={isShelf ? '—' : band.Q.toFixed(2)}
              onPress={isShelf ? undefined : () => onEditValue(band.id, 'Q')}
            />
          </AppPressable>
        );
      })}

      {canAdd ? (
        <AppPressable

          unstable_pressDelay={SCROLL_PRESS_DELAY}
          onPress={onAdd}
          style={[styles.strip, styles.addStrip, { width: CONSOLE_ADD_WIDTH }]}
          accessibilityRole="button"
          accessibilityLabel="Add band"
        >
          <Ionicons name="add" size={22} color={colors.accentText} />
        </AppPressable>
      ) : null}
    </ScrollView>
  );
}

/**
 * One value line. Tapping opens the exact-value sheet, the same path the detail
 * panel's value boxes take; a dash means the filter type has no such parameter.
 */
function Readout({
  label,
  value,
  color,
  emphasis = false,
  onPress,
}: {
  label: string;
  value: string;
  color?: string;
  emphasis?: boolean;
  onPress?: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const body = (
    <>
      <Text
        variant={emphasis ? 'body' : 'caption'}
        color={color ?? colors.textPrimary}
        style={styles.readoutValue}
        numberOfLines={1}
      >
        {value}
      </Text>
      <Text variant="caption" color={colors.textTertiary}>
        {label}
      </Text>
    </>
  );
  if (!onPress) {
    return <View style={styles.readout}>{body}</View>;
  }
  return (
    <AppPressable feedback="control"

      unstable_pressDelay={SCROLL_PRESS_DELAY}
      style={styles.readout}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${value} ${label}`}
    >
      {body}
    </AppPressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  content: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  strip: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.glassBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  stripActive: {
    borderColor: colors.accent,
    backgroundColor: colors.glassHighlight,
  },
  addStrip: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    borderColor: colors.glassBorder,
    borderStyle: 'dashed',
  },
  header: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  typeButton: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  rail: {
    alignSelf: 'stretch',
    marginVertical: spacing.xs,
  },
  railDisabled: {
    opacity: 0.35,
  },
  readout: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.sm,
    paddingVertical: 1,
  },
  readoutValue: {
    fontVariant: ['tabular-nums'],
  },
}));

export default BandConsole;
