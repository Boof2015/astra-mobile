import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import type { NowPlayingScopeStyle } from '@/stores/settingsStore';

interface ScopeStyleCardsProps {
  /** null renders neither card selected (onboarding: no preselection bias). */
  value: NowPlayingScopeStyle | null;
  onChange: (style: NowPlayingScopeStyle) => void;
}

// Static waveform-bar heights for the sketch's seekbar row.
const WAVE_BAR_HEIGHTS = [7, 11, 15, 10, 14, 8, 12, 16, 9, 13, 7, 10];

/**
 * Side-by-side chooser for where the now-playing scopes live. Each card is a
 * wireframe of the whole player screen — art, titles, seekbar, transport — so
 * the placement makes sense even before someone has seen the real thing. The
 * accent-colored strips are the scopes; everything else stays neutral.
 */
export function ScopeStyleCards({ value, onChange }: ScopeStyleCardsProps) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <StyleCard
        variant="rail"
        title="Below artwork"
        description="One scope at a time, in a strip under the cover."
        selected={value === 'rail'}
        onPress={() => onChange('rail')}
      />
      <StyleCard
        variant="rack"
        title="In artwork"
        description="Both scopes stacked inside the cover frame."
        selected={value === 'rack'}
        onPress={() => onChange('rack')}
      />
    </View>
  );
}

function StyleCard({
  variant,
  title,
  description,
  selected,
  onPress,
}: {
  variant: NowPlayingScopeStyle;
  title: string;
  description: string;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();

  return (
    <Pressable
      android_ripple={ripple.bounded}
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${description}`}
    >
      <PlayerSketch variant={variant} />
      <Text
        variant="label"
        color={selected ? colors.accentTextStrong : colors.textPrimary}
        style={styles.cardTitle}
      >
        {title}
      </Text>
      <Text variant="caption" color={colors.textSecondary} style={styles.cardDescription}>
        {description}
      </Text>
    </Pressable>
  );
}

/** Miniature now-playing screen; only the scope strips carry the accent. */
function PlayerSketch({ variant }: { variant: NowPlayingScopeStyle }) {
  const styles = useStyles();
  return (
    <View style={styles.sketch}>
      {variant === 'rail' ? (
        <>
          <View style={styles.sketchArt} />
          <View style={styles.sketchScopeStrip} />
        </>
      ) : (
        <View style={[styles.sketchArt, styles.sketchArtFilled]}>
          <View style={styles.sketchInnerStrip} />
          <View style={styles.sketchInnerStrip} />
        </View>
      )}

      <View style={styles.sketchTextBlock}>
        <View style={styles.sketchTitleLine} />
        <View style={styles.sketchArtistLine} />
      </View>

      <View style={styles.sketchWaveRow}>
        {WAVE_BAR_HEIGHTS.map((barHeight, index) => (
          <View key={index} style={[styles.sketchWaveBar, { height: barHeight }]} />
        ))}
      </View>

      <View style={styles.sketchTransport}>
        <View style={styles.sketchSideButton} />
        <View style={styles.sketchPlayButton} />
        <View style={styles.sketchSideButton} />
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  card: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  cardSelected: {
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentGlow,
  },
  cardTitle: {
    textAlign: 'center',
  },
  cardDescription: {
    textAlign: 'center',
    marginTop: 2,
  },
  // Fixed-footprint mini player so both cards line up regardless of variant.
  sketch: {
    height: 168,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginBottom: spacing.sm,
  },
  sketchArt: {
    width: 64,
    height: 64,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.textTertiary,
  },
  sketchArtFilled: {
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  sketchScopeStrip: {
    width: 64,
    height: 9,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  sketchInnerStrip: {
    width: 46,
    height: 7,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  sketchTextBlock: {
    alignSelf: 'flex-start',
    marginLeft: spacing.md,
    gap: 4,
    marginTop: 2,
  },
  sketchTitleLine: {
    width: 52,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.textTertiary,
  },
  sketchArtistLine: {
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.glassBorder,
  },
  sketchWaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2.5,
    height: 16,
  },
  sketchWaveBar: {
    width: 3,
    borderRadius: 1.5,
    backgroundColor: colors.textTertiary,
    opacity: 0.7,
  },
  sketchTransport: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 1,
  },
  sketchSideButton: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.textTertiary,
  },
  sketchPlayButton: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.textSecondary,
  },
}));

export default ScopeStyleCards;
