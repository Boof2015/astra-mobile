import { View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { AppPressable } from '@/components/AppPressable';
import { Text } from '@/components/Text';
import { AccentSwatchRow } from '@/components/settings/AccentSwatchRow';
import { ScopeStyleCards } from '@/components/settings/ScopeStyleCards';
import { playHaptic } from '@/lib/haptics';
import { useSettingsStore, type NowPlayingScopeStyle } from '@/stores/settingsStore';
import { previewTheme, useThemeStore } from '@/stores/themeStore';
import { fonts, spacing } from '@/theme';
import type { Palette } from '@/theme/palettes';
import type { BaseThemeId } from '@/theme/resolve';
import { createThemedStyles, useColors } from '@/theme/themed';
import { OnboardingFrame, useOnboardingNav } from './OnboardingFrame';

const THEME_OPTIONS: { id: BaseThemeId; title: string }[] = [
  { id: 'system', title: 'System' },
  { id: 'midnight', title: 'Midnight' },
  { id: 'dark', title: 'Dark' },
  { id: 'amoled', title: 'AMOLED' },
  { id: 'light', title: 'Light' },
  { id: 'materialYou', title: 'Material You' },
];

/** Theme + accent. Every card previews its palette as it would really resolve. */
export function ThemeStep() {
  const styles = useStyles();
  const colors = useColors();
  const nav = useOnboardingNav();
  const baseTheme = useThemeStore((s) => s.baseTheme);
  const materialYouAvailable = useThemeStore((s) => s.materialYouAvailable);
  // The whole resolved theme, not just its id: it changes with the accent too,
  // and the swatch pills carry the accent.
  const theme = useThemeStore((s) => s.theme);
  const preferredDark = useThemeStore((s) => s.preferredDark);
  const resolvedId = theme.id;
  const options = THEME_OPTIONS.filter((option) => option.id !== 'materialYou' || materialYouAvailable);
  const accentApplies = !resolvedId.startsWith('materialYou');

  return (
    <OnboardingFrame
      eyebrow="Appearance"
      title="Make it yours"
      subtitle="Pick a theme and an accent. Everything updates as you choose."
      footer={<ActionButton style={styles.grow} variant="primary" label="Continue" onPress={nav.next} />}
    >
      <View style={styles.grid} accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option.id === baseTheme;
          return (
            <AppPressable
              key={option.id}
              style={styles.cell}
              onPress={() => {
                if (selected) return;
                playHaptic('selection');
                void useThemeStore.getState().setBaseTheme(option.id);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${option.title} theme`}
            >
              <View style={[styles.swatchFrame, selected && { borderColor: colors.accent }]}>
                {option.id === 'system' ? (
                  <View style={styles.splitSwatch}>
                    <Swatch palette={previewTheme('light').colors} />
                    <Swatch palette={previewTheme(preferredDark).colors} />
                  </View>
                ) : (
                  <Swatch palette={previewTheme(option.id).colors} />
                )}
              </View>
              <Text
                variant="label"
                numberOfLines={1}
                color={selected ? colors.accentTextStrong : colors.textSecondary}
                style={[styles.cellLabel, selected && styles.cellLabelSelected]}
              >
                {option.title}
              </Text>
            </AppPressable>
          );
        })}
      </View>
      {accentApplies ? (
        <View style={styles.accents}>
          <AccentSwatchRow />
        </View>
      ) : (
        <Text variant="caption" color={colors.textTertiary} style={styles.caption}>
          Material You takes its accent from your wallpaper.
        </Text>
      )}
    </OnboardingFrame>
  );
}

/** A miniature screen in a palette: two text lines, a card, the accent. */
function Swatch({ palette }: { palette: Palette }) {
  const styles = useStyles();
  return (
    <View style={[styles.swatch, { backgroundColor: palette.bgPrimary }]}>
      <View style={[styles.swatchLine, { backgroundColor: palette.textPrimary }]} />
      <View style={[styles.swatchLineShort, { backgroundColor: palette.textTertiary }]} />
      <View style={[styles.swatchCard, { backgroundColor: palette.bgTertiary }]} />
      <View style={[styles.swatchPill, { backgroundColor: palette.accent }]} />
    </View>
  );
}

/** Where the scopes live. The Settings cards, unchanged, so both places teach the same picture. */
export function PlayerStep({
  choice,
  onChoose,
}: {
  choice: NowPlayingScopeStyle | null;
  onChoose: (style: NowPlayingScopeStyle) => void;
}) {
  const styles = useStyles();
  const nav = useOnboardingNav();
  return (
    <OnboardingFrame
      eyebrow="Appearance"
      title="Your player"
      subtitle="Astra can draw live scopes of the music. Choose where they sit. You can change this later in Settings."
      footer={<ActionButton style={styles.grow} variant="primary" label="Continue" onPress={nav.next} />}
    >
      <ScopeStyleCards
        value={choice}
        onChange={(style) => {
          onChoose(style);
          void useSettingsStore.getState().setNowPlayingScopeStyle(style);
        }}
      />
    </OnboardingFrame>
  );
}

const useStyles = createThemedStyles((colors) => ({
  grow: {
    flex: 1,
    minHeight: 52,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  cell: {
    // Three to a row; the gaps are part of the row, so a third of (100% - 2 gaps).
    width: '31.5%',
    flexGrow: 1,
    gap: 7,
  },
  swatchFrame: {
    height: 88,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
  },
  splitSwatch: {
    flex: 1,
    flexDirection: 'row',
  },
  swatch: {
    flex: 1,
    padding: 9,
    gap: 5,
  },
  swatchLine: {
    width: '55%',
    height: 5,
    borderRadius: 3,
    opacity: 0.85,
  },
  swatchLineShort: {
    width: '35%',
    height: 5,
    borderRadius: 3,
  },
  swatchCard: {
    height: 22,
    borderRadius: 6,
    marginTop: 2,
  },
  swatchPill: {
    position: 'absolute',
    left: 9,
    right: 9,
    bottom: 9,
    height: 10,
    borderRadius: 5,
  },
  cellLabel: {
    textAlign: 'center',
  },
  cellLabelSelected: {
    fontFamily: fonts.sans.semibold,
  },
  accents: {
    marginTop: spacing.xl,
  },
  caption: {
    marginTop: spacing.lg,
  },
}));
