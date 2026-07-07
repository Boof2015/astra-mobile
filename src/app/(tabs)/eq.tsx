import { useCallback, useState } from 'react';
import {
  InteractionManager,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { readAsStringAsync } from 'expo-file-system/legacy';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { EQGraph } from '@/components/eq/EQGraph';
import { BandStrip } from '@/components/eq/BandStrip';
import { BandDetailPanel, type EQEditableValue } from '@/components/eq/BandDetailPanel';
import { EQSlider } from '@/components/eq/EQSlider';
import { EqSheet, EqSheetItem } from '@/components/eq/EqSheet';
import { EQModeSwitcher } from '@/components/eq/EQModeSwitcher';
import { EQValueEditSheet } from '@/components/eq/EQValueEditSheet';
import { GraphicEQPanel } from '@/components/eq/GraphicEQPanel';
import { PresetSheet } from '@/components/eq/PresetSheet';
import { SavePresetSheet } from '@/components/eq/SavePresetSheet';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { isWideWindow } from '@/theme/adaptive';
import { useEQStore } from '@/stores/eqStore';
import { useScopeActive } from '@/scope/scopeStore';
import { setActivePostEqNative } from '@/audio/eqNative';
import {
  EQ_MAX_BANDS,
  EQ_MAX_FREQUENCY,
  EQ_MAX_GAIN_DB,
  EQ_MAX_PREAMP_DB,
  EQ_MAX_Q,
  EQ_MIN_FREQUENCY,
  EQ_MIN_PREAMP_DB,
  EQ_MIN_Q,
  isPassEQBandType
} from '@/audio/eq';
import { parseAutoEQ } from '@/audio/autoEQParser';
import { BAND_TYPE_LABEL, formatGain } from '@/components/eq/format';
import type { EQBand, EQBandType } from '@/types/audio';

type SheetKind = 'none' | 'preset' | 'save' | 'overflow' | 'type';

const BAND_TYPES: EQBandType[] = ['lowshelf', 'peaking', 'highshelf', 'highpass', 'lowpass'];

export default function EQScreen() {
  const styles = useStyles();
  const colors = useColors();
  const eq = useEQStore();
  const scopeActive = useScopeActive();
  const [focused, setFocused] = useState(false);
  const [sheet, setSheet] = useState<SheetKind>('none');
  const [editingValue, setEditingValue] = useState<EQEditableValue | null>(null);
  const closeSheet = useCallback(() => setSheet('none'), []);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const availableWidth = windowWidth - insets.left - insets.right;
  const isWide = isWideWindow(availableWidth, windowHeight - insets.top - insets.bottom);
  // Editing pane keeps a phone-ish width; the graph gets everything else.
  const sidePaneWidth = Math.min(360, Math.max(280, Math.round(availableWidth * 0.4)));

  // Gate the post-EQ tap to while this screen is visible.
  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        setFocused(true);
        setActivePostEqNative(true);
      });
      return () => {
        task.cancel();
        setFocused(false);
        setActivePostEqNative(false);
      };
    }, [])
  );

  const isGraphic = eq.mode === 'graphic';
  const activeBand = eq.bands.find((b) => b.id === eq.activeBandId) ?? null;
  const activeBandNumber = eq.bands.findIndex((b) => b.id === eq.activeBandId) + 1;
  const presetName = eq.presets.find((p) => p.id === eq.activePresetId)?.name ?? 'Custom';
  const defaultPresetName = `Preset ${eq.presets.filter((p) => p.isCustom).length + 1}`;
  const valueEditConfig = activeBand && editingValue ? getValueEditConfig(editingValue, activeBand) : null;

  const handleImportAutoEQ = async () => {
    closeSheet();
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const content = await readAsStringAsync(asset.uri);
      const preset = parseAutoEQ(content, asset.name);
      if (preset.bands.length > 0) eq.importPreset(preset);
    } catch {
      /* invalid file — ignore */
    }
  };

  const presetRowEl = (
    <Pressable
      style={[styles.presetRow, isWide && styles.sideItem]}
      onPress={() => setSheet('preset')}
    >
      <Text variant="body" color={colors.textPrimary}>
        {presetName}
      </Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </Pressable>
  );

  const modeSwitcherEl = (
    <View style={[styles.modeSwitcherWrap, isWide && styles.sideItem]}>
      <EQModeSwitcher value={eq.mode} onChange={eq.setMode} />
    </View>
  );

  const graphEl = (
    <EQGraph
      bands={eq.bands}
      activeBandId={eq.activeBandId}
      enabled={eq.enabled}
      spectrumActive={scopeActive && focused}
      onSelectBand={eq.selectBand}
      onChangeBand={(id, updates) => eq.updateBand(id, updates)}
    />
  );

  // Graphic editor card — the panel draws its response curve behind the sliders
  // in the tracks' own coordinate space, so it stays glued to the thumbs.
  const graphicEditorEl = (
    <View style={styles.graphicEditor}>
      <GraphicEQPanel gains={eq.graphicGains} enabled={eq.enabled} onChangeGain={eq.setGraphicGain} />
    </View>
  );

  const stripEl = (
    <BandStrip
      bands={eq.bands}
      activeBandId={eq.activeBandId}
      canAdd={eq.bands.length < EQ_MAX_BANDS}
      onSelect={eq.selectBand}
      onAdd={() => eq.addBand()}
    />
  );

  const detailEl = (
    <BandDetailPanel
      band={activeBand}
      bandNumber={activeBandNumber > 0 ? activeBandNumber : 1}
      onUpdate={(updates) => activeBand && eq.updateBand(activeBand.id, updates)}
      onEditType={() => setSheet('type')}
      onEditValue={setEditingValue}
    />
  );

  const bottomBarEl = (
    <View style={[styles.bottomBar, isWide && styles.bottomBarWide]}>
      <View style={styles.preamp}>
        <EQSlider
          label="Preamp"
          value={eq.preamp}
          min={EQ_MIN_PREAMP_DB}
          max={EQ_MAX_PREAMP_DB}
          format={(v) => `${formatGain(v)} dB`}
          onChange={eq.setPreamp}
        />
      </View>
      <Pressable
        style={[styles.eqToggle, eq.enabled && styles.eqToggleOn]}
        onPress={eq.toggleEnabled}
      >
        <Ionicons
          name="power"
          size={16}
          color={eq.enabled ? colors.accentTextStrong : colors.textSecondary}
        />
        <Text variant="label" color={eq.enabled ? colors.accentTextStrong : colors.textSecondary}>
          {eq.enabled ? 'EQ on' : 'EQ off'}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <Screen padded={false}>
      <View
        style={[
          styles.header,
          { paddingLeft: spacing.lg + insets.left, paddingRight: spacing.lg + insets.right },
        ]}
      >
        <Text variant="heading">Equalizer</Text>
        <View style={styles.headerActions}>
          <Pressable style={styles.iconButton} onPress={() => setSheet('save')} hitSlop={8}>
            <Ionicons name="save-outline" size={20} color={colors.textSecondary} />
          </Pressable>
          <Pressable style={styles.iconButton} onPress={() => setSheet('overflow')} hitSlop={8}>
            <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      {isWide ? (
        <View
          style={[
            styles.wideBody,
            { paddingLeft: spacing.lg + insets.left, paddingRight: spacing.lg + insets.right },
          ]}
        >
          <View style={styles.wideGraphPane}>{isGraphic ? graphicEditorEl : graphEl}</View>
          <View style={{ width: sidePaneWidth }}>
            {modeSwitcherEl}
            {presetRowEl}
            {isGraphic ? null : (
              <>
                {stripEl}
                <View style={styles.sideDetail}>{detailEl}</View>
              </>
            )}
            <View style={styles.wideSpacer} />
            {bottomBarEl}
          </View>
        </View>
      ) : (
        <>
          {modeSwitcherEl}
          {presetRowEl}
          {isGraphic ? (
            <View style={styles.graphWrap}>{graphicEditorEl}</View>
          ) : (
            <>
              <View style={styles.graphWrap}>{graphEl}</View>
              <View style={styles.section}>{stripEl}</View>
              <View style={styles.section}>{detailEl}</View>
            </>
          )}
          {bottomBarEl}
        </>
      )}

      {sheet === 'preset' ? (
        <PresetSheet
          presets={eq.presets}
          activePresetId={eq.activePresetId}
          onApply={eq.applyPreset}
          onDelete={eq.deleteCustomPreset}
          onSaveNew={() => setSheet('save')}
          onClose={closeSheet}
        />
      ) : null}

      {sheet === 'save' ? (
        <SavePresetSheet
          defaultName={defaultPresetName}
          onSave={(name) => eq.saveCustomPreset(name)}
          onClose={closeSheet}
        />
      ) : null}

      {sheet === 'overflow' ? (
        <EqSheet onClose={closeSheet}>
          <EqSheetItem label="Import AutoEQ…" icon="download-outline" onPress={handleImportAutoEQ} />
          {!isGraphic && eq.bands.length > 1 && activeBand ? (
            <EqSheetItem
              label={`Remove band ${activeBandNumber}`}
              icon="remove-circle-outline"
              onPress={() => {
                eq.removeBand(activeBand.id);
                closeSheet();
              }}
            />
          ) : null}
          <EqSheetItem
            label="Reset to Flat"
            icon="refresh-outline"
            destructive
            onPress={() => {
              eq.resetToFlat();
              closeSheet();
            }}
          />
        </EqSheet>
      ) : null}

      {sheet === 'type' && activeBand ? (
        <EqSheet onClose={closeSheet}>
          <Text variant="heading" style={styles.sheetTitle}>
            Filter type
          </Text>
          {BAND_TYPES.map((type) => (
            <EqSheetItem
              key={type}
              label={BAND_TYPE_LABEL[type]}
              selected={type === activeBand.type}
              onPress={() => {
                eq.updateBand(activeBand.id, { type });
                closeSheet();
              }}
            />
          ))}
        </EqSheet>
      ) : null}

      {valueEditConfig && activeBand && editingValue ? (
        <EQValueEditSheet
          title={valueEditConfig.title}
          initialValue={valueEditConfig.initialValue}
          unit={valueEditConfig.unit}
          rangeLabel={valueEditConfig.rangeLabel}
          placeholder={valueEditConfig.placeholder}
          keyboardType={valueEditConfig.keyboardType}
          parseValue={valueEditConfig.parseValue}
          onApply={(value) => eq.updateBand(activeBand.id, createValueUpdate(editingValue, value))}
          onClose={() => setEditingValue(null)}
        />
      ) : null}
    </Screen>
  );
}

function getValueEditConfig(kind: EQEditableValue, band: EQBand) {
  switch (kind) {
    case 'frequency':
      return {
        title: 'Edit frequency',
        initialValue: String(Math.round(band.frequency)),
        unit: 'Hz',
        rangeLabel: `${EQ_MIN_FREQUENCY}-${EQ_MAX_FREQUENCY} Hz`,
        placeholder: '1000 or 1k',
        keyboardType: 'default' as const,
        parseValue: parseFrequency,
      };
    case 'gain':
      if (isPassEQBandType(band.type)) return null;
      return {
        title: 'Edit gain',
        initialValue: band.gain.toFixed(1),
        unit: 'dB',
        rangeLabel: `${-EQ_MAX_GAIN_DB} to +${EQ_MAX_GAIN_DB} dB`,
        placeholder: '0.0',
        keyboardType: 'numbers-and-punctuation' as const,
        parseValue: parseDb,
      };
    case 'Q':
      return {
        title: 'Edit Q',
        initialValue: band.Q.toFixed(2),
        unit: 'Q',
        rangeLabel: `${EQ_MIN_Q}-${EQ_MAX_Q}`,
        placeholder: '1.00',
        keyboardType: 'numbers-and-punctuation' as const,
        parseValue: parsePlainNumber,
      };
  }
}

function createValueUpdate(kind: EQEditableValue, value: number): Partial<EQBand> {
  switch (kind) {
    case 'frequency':
      return { frequency: value };
    case 'gain':
      return { gain: value };
    case 'Q':
      return { Q: value };
  }
}

function parseFrequency(value: string): number | null {
  const match = value
    .trim()
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .match(/^([+-]?(?:\d+\.?\d*|\.\d+))(khz|hz|k)?$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return null;
  return match[2] === 'k' || match[2] === 'khz' ? parsed * 1000 : parsed;
}

function parseDb(value: string): number | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
  const raw = normalized.endsWith('db') ? normalized.slice(0, -2) : normalized;
  return parsePlainNumber(raw);
}

function parsePlainNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const useStyles = createThemedStyles((colors) => ({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  modeSwitcherWrap: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  graphicEditor: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.bgSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  presetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
  },
  graphWrap: {
    flex: 1,
    minHeight: 180,
    marginHorizontal: spacing.lg,
  },
  section: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  wideBody: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.lg,
    paddingBottom: spacing.sm,
  },
  wideGraphPane: {
    flex: 1,
    minWidth: 0,
  },
  wideSpacer: {
    flex: 1,
  },
  sideItem: {
    marginHorizontal: 0,
  },
  sideDetail: {
    marginTop: spacing.md,
  },
  bottomBarWide: {
    paddingHorizontal: 0,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  preamp: {
    flex: 1,
  },
  eqToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  eqToggleOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentGlow,
  },
  sheetTitle: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
}));
