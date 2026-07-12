import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Text } from '@/components/Text';
import {
  AppSheet,
  AppSheetItem,
  AppSheetSection,
  AppSheetTitle,
} from '@/components/sheets/AppSheet';
import { fonts, fontSize, radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import { usePlaylistStore } from '@/stores/playlistStore';
import {
  DYNAMIC_PLAYLIST_PRESETS,
  createDefaultDynamicPlaylistRules,
  normalizeDynamicPlaylistCondition,
  normalizeDynamicPlaylistRules,
  type DynamicPlaylistAddedAtCondition,
  type DynamicPlaylistCondition,
  type DynamicPlaylistDateField,
  type DynamicPlaylistExactField,
  type DynamicPlaylistFavoriteCondition,
  type DynamicPlaylistLastPlayedCondition,
  type DynamicPlaylistNumericCondition,
  type DynamicPlaylistNumericField,
  type DynamicPlaylistPreview,
  type DynamicPlaylistRulesV1,
  type DynamicPlaylistSort,
  type DynamicPlaylistSortField,
  type DynamicPlaylistSourceCondition,
  type DynamicPlaylistTextCondition,
  type DynamicPlaylistTextField,
} from '@/shared/playlists/dynamicPlaylist';

type ConditionFieldKey =
  `${DynamicPlaylistCondition['kind']}:${DynamicPlaylistTextField | DynamicPlaylistNumericField | DynamicPlaylistDateField | DynamicPlaylistExactField}`;

type FieldGroup = 'text' | 'activity' | 'library' | 'audio';

interface FieldOption {
  key: ConditionFieldKey;
  label: string;
  group: FieldGroup;
  icon: keyof typeof Ionicons.glyphMap;
}

type ConditionEditorTarget =
  | { mode: 'new'; draft: DynamicPlaylistCondition }
  | { mode: 'edit'; index: number; draft: DynamicPlaylistCondition };

type EditorSheet =
  | { kind: 'field-picker'; target: 'new' | ConditionEditorTarget }
  | { kind: 'condition'; target: ConditionEditorTarget }
  | { kind: 'sort'; draftSort: DynamicPlaylistSort; limitText: string }
  | { kind: 'preview' }
  | null;

const FIELD_OPTIONS: readonly FieldOption[] = [
  { key: 'text:title', label: 'Title', group: 'text', icon: 'text-outline' },
  { key: 'text:artist', label: 'Artist', group: 'text', icon: 'person-outline' },
  { key: 'text:album', label: 'Album', group: 'text', icon: 'albums-outline' },
  { key: 'text:album_artist', label: 'Album artist', group: 'text', icon: 'people-outline' },
  { key: 'text:genre', label: 'Genre', group: 'text', icon: 'pricetag-outline' },
  { key: 'numeric:play_count', label: 'Play count', group: 'activity', icon: 'repeat-outline' },
  { key: 'date:last_played_at', label: 'Last played', group: 'activity', icon: 'time-outline' },
  { key: 'exact:favorite', label: 'Favorite', group: 'activity', icon: 'heart-outline' },
  { key: 'date:added_at', label: 'Added', group: 'library', icon: 'calendar-outline' },
  { key: 'exact:source_type', label: 'Source', group: 'library', icon: 'cloud-outline' },
  { key: 'text:format', label: 'Format', group: 'library', icon: 'document-text-outline' },
  { key: 'numeric:year', label: 'Year', group: 'audio', icon: 'calendar-number-outline' },
  { key: 'numeric:duration_seconds', label: 'Duration', group: 'audio', icon: 'timer-outline' },
  { key: 'numeric:bpm', label: 'BPM', group: 'audio', icon: 'pulse-outline' },
  { key: 'text:musical_key', label: 'Key', group: 'audio', icon: 'musical-notes-outline' },
];

const FIELD_GROUP_LABELS: Record<FieldGroup, string> = {
  text: 'TEXT',
  activity: 'ACTIVITY',
  library: 'LIBRARY',
  audio: 'AUDIO',
};

const SORT_LABELS: Record<DynamicPlaylistSortField, string> = {
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  added_at: 'Added',
  last_played_at: 'Last played',
  play_count: 'Play count',
  year: 'Year',
  duration_seconds: 'Duration',
  bpm: 'BPM',
};

const TEXT_OPERATOR_LABELS: Record<DynamicPlaylistTextCondition['operator'], string> = {
  contains: 'Contains',
  is: 'Is',
  is_not: 'Is not',
};

const NUMERIC_OPERATOR_LABELS: Record<DynamicPlaylistNumericCondition['operator'], string> = {
  eq: 'Is',
  gte: 'At least',
  lte: 'At most',
};

const LAST_PLAYED_OPERATOR_LABELS: Record<DynamicPlaylistLastPlayedCondition['operator'], string> = {
  never: 'Never',
  within_days: 'Within',
  not_within_days: 'Not within',
};

const ADDED_AT_OPERATOR_LABELS: Record<DynamicPlaylistAddedAtCondition['operator'], string> = {
  within_days: 'Within',
  older_than_days: 'Older than',
};

const EXACT_OPERATOR_LABELS: Record<DynamicPlaylistSourceCondition['operator'], string> = {
  is: 'Is',
  is_not: 'Is not',
};

const SORT_FIELD_OPTIONS = Object.entries(SORT_LABELS) as [DynamicPlaylistSortField, string][];

function fieldOptionForKey(key: ConditionFieldKey): FieldOption | undefined {
  return FIELD_OPTIONS.find((option) => option.key === key);
}

function createDefaultCondition(fieldKey: ConditionFieldKey = 'text:artist'): DynamicPlaylistCondition {
  const [kind, field] = fieldKey.split(':') as [DynamicPlaylistCondition['kind'], string];
  if (kind === 'numeric') {
    const value =
      field === 'play_count' ? 1 : field === 'duration_seconds' ? 180 : field === 'bpm' ? 120 : 2000;
    return {
      kind,
      field: field as DynamicPlaylistNumericField,
      operator: 'gte',
      value,
    };
  }
  if (kind === 'date') {
    return field === 'last_played_at'
      ? { kind, field, operator: 'not_within_days', value: 30 }
      : { kind, field: 'added_at', operator: 'within_days', value: 30 };
  }
  if (kind === 'exact') {
    return field === 'source_type'
      ? { kind, field, operator: 'is', value: 'local' }
      : { kind, field: 'favorite', operator: 'is', value: true };
  }
  return { kind, field: field as DynamicPlaylistTextField, operator: 'contains', value: '' };
}

function getConditionFieldKey(condition: DynamicPlaylistCondition): ConditionFieldKey {
  return `${condition.kind}:${condition.field}` as ConditionFieldKey;
}

function fieldLabel(condition: DynamicPlaylistCondition): string {
  return fieldOptionForKey(getConditionFieldKey(condition))?.label ?? condition.field;
}

function fieldGroupLabel(condition: DynamicPlaylistCondition): string {
  const group = fieldOptionForKey(getConditionFieldKey(condition))?.group ?? 'text';
  return FIELD_GROUP_LABELS[group];
}

function updateCondition(
  rules: DynamicPlaylistRulesV1,
  index: number,
  condition: DynamicPlaylistCondition
): DynamicPlaylistRulesV1 {
  return {
    ...rules,
    conditions: rules.conditions.map((entry, entryIndex) => (entryIndex === index ? condition : entry)),
  };
}

function removeCondition(rules: DynamicPlaylistRulesV1, index: number): DynamicPlaylistRulesV1 {
  return {
    ...rules,
    conditions: rules.conditions.filter((_, entryIndex) => entryIndex !== index),
  };
}

function updateTextOperator(
  condition: DynamicPlaylistTextCondition,
  operator: DynamicPlaylistTextCondition['operator']
): DynamicPlaylistTextCondition {
  return { ...condition, operator };
}

function updateNumericOperator(
  condition: DynamicPlaylistNumericCondition,
  operator: DynamicPlaylistNumericCondition['operator']
): DynamicPlaylistNumericCondition {
  return { ...condition, operator };
}

function updateDateOperator(
  condition: DynamicPlaylistLastPlayedCondition | DynamicPlaylistAddedAtCondition,
  operator: string
): DynamicPlaylistLastPlayedCondition | DynamicPlaylistAddedAtCondition {
  if (condition.field === 'last_played_at') {
    if (operator === 'never') return { kind: 'date', field: 'last_played_at', operator };
    return {
      kind: 'date',
      field: 'last_played_at',
      operator: operator === 'within_days' ? 'within_days' : 'not_within_days',
      value: condition.value ?? 30,
    };
  }

  return {
    kind: 'date',
    field: 'added_at',
    operator: operator === 'older_than_days' ? 'older_than_days' : 'within_days',
    value: condition.value,
  };
}

function updateExactOperator(
  condition: DynamicPlaylistSourceCondition | DynamicPlaylistFavoriteCondition,
  operator: DynamicPlaylistSourceCondition['operator']
): DynamicPlaylistSourceCondition | DynamicPlaylistFavoriteCondition {
  return { ...condition, operator } as DynamicPlaylistSourceCondition | DynamicPlaylistFavoriteCondition;
}

function validateCondition(condition: DynamicPlaylistCondition): string | null {
  try {
    normalizeDynamicPlaylistCondition(condition);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Filter is incomplete.';
  }
}

function rulesEqual(a: DynamicPlaylistRulesV1, b: DynamicPlaylistRulesV1): boolean {
  return JSON.stringify(normalizeDynamicPlaylistRules(a)) === JSON.stringify(normalizeDynamicPlaylistRules(b));
}

function sourceLabel(value: DynamicPlaylistSourceCondition['value']): string {
  return value === 'subsonic' ? 'Subsonic' : value === 'jellyfin' ? 'Jellyfin' : 'Local';
}

function describeCondition(condition: DynamicPlaylistCondition): string {
  const label = fieldLabel(condition);

  if (condition.kind === 'text') {
    const value = condition.value.trim() ? `"${condition.value.trim()}"` : 'value';
    return `${label} ${TEXT_OPERATOR_LABELS[condition.operator].toLowerCase()} ${value}`;
  }

  if (condition.kind === 'numeric') {
    return `${label} ${NUMERIC_OPERATOR_LABELS[condition.operator].toLowerCase()} ${condition.value}`;
  }

  if (condition.kind === 'date') {
    if (condition.field === 'last_played_at' && condition.operator === 'never') {
      return `${label} never`;
    }
    const operator =
      condition.field === 'last_played_at'
        ? LAST_PLAYED_OPERATOR_LABELS[condition.operator]
        : ADDED_AT_OPERATOR_LABELS[condition.operator];
    return `${label} ${operator.toLowerCase()} ${condition.value ?? 30} days`;
  }

  if (condition.field === 'source_type') {
    return `${label} ${EXACT_OPERATOR_LABELS[condition.operator].toLowerCase()} ${sourceLabel(condition.value)}`;
  }

  return `${label} ${EXACT_OPERATOR_LABELS[condition.operator].toLowerCase()} ${condition.value ? 'Yes' : 'No'}`;
}

function describeSort(sort: DynamicPlaylistSort, limit: number | null): string {
  const direction = sort.direction === 'asc' ? 'Ascending' : 'Descending';
  const limitLabel = limit === null ? 'No limit' : `Limit ${limit}`;
  return `${SORT_LABELS[sort.field]} · ${direction} · ${limitLabel}`;
}

function previewStatus({
  isLoadingRules,
  isPreviewLoading,
  preview,
  normalizedRulesError,
  previewError,
}: {
  isLoadingRules: boolean;
  isPreviewLoading: boolean;
  preview: DynamicPlaylistPreview | null;
  normalizedRulesError: string | null;
  previewError: string | null;
}): { label: string; tone: 'normal' | 'warning' } {
  if (isLoadingRules) return { label: 'Loading rules', tone: 'normal' };
  if (normalizedRulesError) return { label: 'Fix filters', tone: 'warning' };
  if (previewError) return { label: 'Preview unavailable', tone: 'warning' };
  if (isPreviewLoading) return { label: 'Previewing', tone: 'normal' };
  const count = preview?.track_count ?? 0;
  return { label: `${count} ${count === 1 ? 'track' : 'tracks'}`, tone: 'normal' };
}

function DraftActions({
  disabled,
  onCancel,
  onApply,
}: {
  disabled?: boolean;
  onCancel: () => void;
  onApply: () => void;
}) {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  return (
    <View style={styles.sheetActions}>
      <Pressable android_ripple={ripple.bounded} style={[styles.sheetButton, styles.cancelButton]} onPress={onCancel} accessibilityRole="button">
        <Text variant="label" color={colors.textSecondary}>
          Cancel
        </Text>
      </Pressable>
      <Pressable android_ripple={ripple.bounded}
        style={[styles.sheetButton, styles.applyButton, disabled && styles.applyDisabled]}
        disabled={disabled}
        onPress={onApply}
        accessibilityRole="button"
      >
        <Text variant="label" color={colors.accentTextStrong}>
          Apply
        </Text>
      </Pressable>
    </View>
  );
}

function OperatorControl({
  condition,
  onChange,
}: {
  condition: DynamicPlaylistCondition;
  onChange: (condition: DynamicPlaylistCondition) => void;
}) {
  if (condition.kind === 'text') {
    return (
      <SegmentedControl
        value={condition.operator}
        segments={[
          { key: 'contains', label: 'Contains' },
          { key: 'is', label: 'Is' },
          { key: 'is_not', label: 'Is not' },
        ]}
        onChange={(operator) =>
          onChange(updateTextOperator(condition, operator as DynamicPlaylistTextCondition['operator']))
        }
      />
    );
  }

  if (condition.kind === 'numeric') {
    return (
      <SegmentedControl
        value={condition.operator}
        segments={[
          { key: 'eq', label: 'Is' },
          { key: 'gte', label: 'At least' },
          { key: 'lte', label: 'At most' },
        ]}
        onChange={(operator) =>
          onChange(updateNumericOperator(condition, operator as DynamicPlaylistNumericCondition['operator']))
        }
      />
    );
  }

  if (condition.kind === 'date') {
    const segments =
      condition.field === 'last_played_at'
        ? [
            { key: 'never', label: 'Never' },
            { key: 'within_days', label: 'Within' },
            { key: 'not_within_days', label: 'Not within' },
          ]
        : [
            { key: 'within_days', label: 'Within' },
            { key: 'older_than_days', label: 'Older than' },
          ];
    return (
      <SegmentedControl
        value={condition.operator}
        segments={segments}
        onChange={(operator) => onChange(updateDateOperator(condition, operator))}
      />
    );
  }

  return (
    <SegmentedControl
      value={condition.operator}
      segments={[
        { key: 'is', label: 'Is' },
        { key: 'is_not', label: 'Is not' },
      ]}
      onChange={(operator) =>
        onChange(updateExactOperator(condition, operator as DynamicPlaylistSourceCondition['operator']))
      }
    />
  );
}

function ConditionValueEditor({
  condition,
  onChange,
}: {
  condition: DynamicPlaylistCondition;
  onChange: (condition: DynamicPlaylistCondition) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  if (condition.kind === 'text') {
    return (
      <BottomSheetTextInput
        style={styles.sheetInput}
        value={condition.value}
        onChangeText={(value) => onChange({ ...condition, value })}
        placeholder="Value"
        placeholderTextColor={colors.textTertiary}
        autoFocus
        returnKeyType="done"
        selectionColor={colors.accent}
      />
    );
  }

  if (condition.kind === 'numeric') {
    return (
      <BottomSheetTextInput
        style={styles.sheetInput}
        value={Number.isFinite(condition.value) ? String(condition.value) : ''}
        onChangeText={(value) => onChange({ ...condition, value: Number(value) })}
        keyboardType="numeric"
        placeholder="0"
        placeholderTextColor={colors.textTertiary}
        selectTextOnFocus
        returnKeyType="done"
        selectionColor={colors.accent}
      />
    );
  }

  if (condition.kind === 'date') {
    if (condition.field === 'last_played_at' && condition.operator === 'never') return null;
    return (
      <View style={styles.valueWithUnit}>
        <BottomSheetTextInput
          style={[styles.sheetInput, styles.valueInput]}
          value={String(condition.value ?? 30)}
          onChangeText={(value) => onChange({ ...condition, value: Number(value) } as DynamicPlaylistCondition)}
          keyboardType="numeric"
          placeholder="30"
          placeholderTextColor={colors.textTertiary}
          selectTextOnFocus
          returnKeyType="done"
          selectionColor={colors.accent}
        />
        <Text variant="label" color={colors.textSecondary}>
          days
        </Text>
      </View>
    );
  }

  if (condition.field === 'source_type') {
    return (
      <SegmentedControl
        value={condition.value}
        segments={[
          { key: 'local', label: 'Local' },
          { key: 'subsonic', label: 'Subsonic' },
          { key: 'jellyfin', label: 'Jellyfin' },
        ]}
        onChange={(value) =>
          onChange({ ...condition, value: value as DynamicPlaylistSourceCondition['value'] })
        }
      />
    );
  }

  return (
    <SegmentedControl
      value={condition.value ? 'yes' : 'no'}
      segments={[
        { key: 'yes', label: 'Yes' },
        { key: 'no', label: 'No' },
      ]}
      onChange={(value) => onChange({ ...condition, value: value === 'yes' })}
    />
  );
}

function ConditionEditorSheet({
  target,
  onChangeDraft,
  onChangeField,
  onRemove,
  onCancel,
  onApply,
}: {
  target: ConditionEditorTarget;
  onChangeDraft: (condition: DynamicPlaylistCondition) => void;
  onChangeField: () => void;
  onRemove: () => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  const draft = target.draft;
  const error = validateCondition(draft);

  return (
    <AppSheet onClose={onCancel}>
      <AppSheetTitle title={target.mode === 'new' ? 'Add filter' : 'Edit filter'} />
      <Pressable android_ripple={ripple.bounded} style={styles.sheetSelectRow} onPress={onChangeField} accessibilityRole="button">
        <View style={styles.sheetSelectText}>
          <Text variant="caption" color={colors.textTertiary}>
            FIELD
          </Text>
          <Text variant="body">{fieldLabel(draft)}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </Pressable>

      <View style={styles.sheetBlock}>
        <Text variant="caption" color={colors.textTertiary}>
          OPERATOR
        </Text>
        <OperatorControl condition={draft} onChange={onChangeDraft} />
      </View>

      <View style={styles.sheetBlock}>
        <Text variant="caption" color={colors.textTertiary}>
          VALUE
        </Text>
        <ConditionValueEditor condition={draft} onChange={onChangeDraft} />
      </View>

      {error ? (
        <Text variant="label" color={colors.warning} style={styles.sheetError}>
          {error}
        </Text>
      ) : null}

      <View style={styles.conditionSheetFooter}>
        {target.mode === 'edit' ? (
          <Pressable android_ripple={ripple.bounded} style={styles.removeButton} onPress={onRemove} accessibilityRole="button">
            <Ionicons name="trash-outline" size={17} color={colors.warning} />
            <Text variant="label" color={colors.warning}>
              Remove
            </Text>
          </Pressable>
        ) : (
          <View />
        )}
        <DraftActions disabled={error !== null} onCancel={onCancel} onApply={onApply} />
      </View>
    </AppSheet>
  );
}

function SortLimitSheet({
  sort,
  limitText,
  onChangeSort,
  onChangeLimitText,
  onCancel,
  onApply,
}: {
  sort: DynamicPlaylistSort;
  limitText: string;
  onChangeSort: (sort: DynamicPlaylistSort) => void;
  onChangeLimitText: (value: string) => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const trimmedLimit = limitText.trim();
  const parsedLimit = trimmedLimit ? Number(trimmedLimit) : null;
  const limitValid =
    parsedLimit === null || (Number.isFinite(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 5000);
  const applyDisabled = !limitValid;

  return (
    <AppSheet onClose={onCancel}>
      <AppSheetTitle title="Result order" />
      <AppSheetSection label="SORT BY" />
      {SORT_FIELD_OPTIONS.map(([field, label]) => (
        <AppSheetItem
          key={field}
          label={label}
          selected={sort.field === field}
          onPress={() => onChangeSort({ ...sort, field })}
        />
      ))}

      <View style={styles.sheetBlock}>
        <Text variant="caption" color={colors.textTertiary}>
          DIRECTION
        </Text>
        <SegmentedControl
          value={sort.direction}
          segments={[
            { key: 'asc', label: 'Ascending' },
            { key: 'desc', label: 'Descending' },
          ]}
          onChange={(direction) => onChangeSort({ ...sort, direction: direction === 'desc' ? 'desc' : 'asc' })}
        />
      </View>

      <View style={styles.sheetBlock}>
        <Text variant="caption" color={colors.textTertiary}>
          LIMIT
        </Text>
        <BottomSheetTextInput
          style={[styles.sheetInput, trimmedLimit && !limitValid && styles.inputInvalid]}
          value={limitText}
          onChangeText={onChangeLimitText}
          keyboardType="numeric"
          placeholder="No limit"
          placeholderTextColor={colors.textTertiary}
          returnKeyType="done"
          selectionColor={colors.accent}
        />
        {trimmedLimit && !limitValid ? (
          <Text variant="caption" color={colors.warning} style={styles.sheetHelp}>
            Enter 1-5000 or leave blank.
          </Text>
        ) : null}
      </View>

      <DraftActions disabled={applyDisabled} onCancel={onCancel} onApply={onApply} />
    </AppSheet>
  );
}

function PreviewSheet({
  preview,
  previewError,
  isLoading,
  onClose,
}: {
  preview: DynamicPlaylistPreview | null;
  previewError: string | null;
  isLoading: boolean;
  onClose: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const count = preview?.track_count ?? 0;

  return (
    <AppSheet onClose={onClose}>
      <AppSheetTitle title="Preview" subtitle={isLoading ? 'Loading' : `${count} ${count === 1 ? 'track' : 'tracks'}`} />
      {previewError ? (
        <Text variant="label" color={colors.warning} style={styles.previewMessage}>
          {previewError}
        </Text>
      ) : preview?.tracks.length ? (
        <ScrollView style={styles.previewSheetList} showsVerticalScrollIndicator>
          {preview.tracks.map((track) => (
            <View key={track.path} style={styles.previewRow}>
              <Text variant="body" numberOfLines={1}>
                {track.title}
              </Text>
              <Text variant="label" numberOfLines={1} color={colors.textSecondary}>
                {[track.artist, track.album].filter(Boolean).join(' · ')}
              </Text>
            </View>
          ))}
        </ScrollView>
      ) : (
        <Text variant="label" color={colors.textTertiary} style={styles.previewMessage}>
          No matches
        </Text>
      )}
    </AppSheet>
  );
}

function FilterCard({
  condition,
  onPress,
  onRemove,
}: {
  condition: DynamicPlaylistCondition;
  onPress: () => void;
  onRemove: () => void;
}) {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  const option = fieldOptionForKey(getConditionFieldKey(condition));

  return (
    <Pressable android_ripple={ripple.bounded} style={styles.ruleCard} onPress={onPress} accessibilityRole="button">
      <View style={styles.cardIcon}>
        <Ionicons name={option?.icon ?? 'options-outline'} size={18} color={colors.accent} />
      </View>
      <View style={styles.cardText}>
        <Text variant="body" numberOfLines={2}>
          {describeCondition(condition)}
        </Text>
        <Text variant="caption" color={colors.textTertiary}>
          {fieldGroupLabel(condition)}
        </Text>
      </View>
      <Pressable android_ripple={ripple.bounded}
        style={styles.cardRemove}
        onPress={onRemove}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Remove filter"
      >
        <Ionicons name="close" size={18} color={colors.textTertiary} />
      </Pressable>
    </Pressable>
  );
}

export default function DynamicPlaylistEditorScreen() {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const playlistId = id ? Number(id) : null;
  const isEditing = playlistId !== null && Number.isInteger(playlistId) && playlistId > 0;

  const playlists = usePlaylistStore((s) => s.playlists);
  const createDynamicPlaylist = usePlaylistStore((s) => s.createDynamicPlaylist);
  const getDynamicPlaylistRules = usePlaylistStore((s) => s.getDynamicPlaylistRules);
  const updateDynamicPlaylistRules = usePlaylistStore((s) => s.updateDynamicPlaylistRules);
  const renamePlaylist = usePlaylistStore((s) => s.renamePlaylist);
  const previewDynamicPlaylist = usePlaylistStore((s) => s.previewDynamicPlaylist);

  const playlist = isEditing ? playlists.find((entry) => entry.id === playlistId) : null;
  const [name, setName] = useState(() => (isEditing ? playlist?.name ?? 'Dynamic playlist' : ''));
  const [rules, setRules] = useState<DynamicPlaylistRulesV1>(() => createDefaultDynamicPlaylistRules());
  const [sheet, setSheet] = useState<EditorSheet>(null);
  const [isLoadingRules, setIsLoadingRules] = useState(isEditing);
  const [isSaving, setIsSaving] = useState(false);
  const [preview, setPreview] = useState<DynamicPlaylistPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  useEffect(() => {
    if (!isEditing || playlistId == null) return;
    let didCancel = false;
    void getDynamicPlaylistRules(playlistId)
      .then((nextRules) => {
        if (!didCancel) {
          setName(playlist?.name ?? 'Dynamic playlist');
          setRules(nextRules);
        }
      })
      .catch((err) => {
        if (!didCancel) {
          Alert.alert('Rules unavailable', err instanceof Error ? err.message : String(err));
          router.back();
        }
      })
      .finally(() => {
        if (!didCancel) setIsLoadingRules(false);
      });
    return () => {
      didCancel = true;
    };
  }, [getDynamicPlaylistRules, isEditing, playlist?.name, playlistId, router]);

  const normalizedRulesError = useMemo(() => {
    try {
      normalizeDynamicPlaylistRules(rules);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Rules are incomplete.';
    }
  }, [rules]);

  const rulesAreDefault = useMemo(() => rulesEqual(rules, createDefaultDynamicPlaylistRules()), [rules]);

  useEffect(() => {
    let didCancel = false;
    if (normalizedRulesError) {
      const timeoutId = setTimeout(() => {
        if (!didCancel) {
          setIsPreviewLoading(false);
          setPreview(null);
          setPreviewError(null);
        }
      }, 0);
      return () => {
        didCancel = true;
        clearTimeout(timeoutId);
      };
    }

    const timeoutId = setTimeout(() => {
      const loadPreview = async () => {
        setIsPreviewLoading(true);
        setPreviewError(null);
        try {
          const normalizedRules = normalizeDynamicPlaylistRules(rules);
          const nextPreview = await previewDynamicPlaylist(normalizedRules);
          if (!didCancel) setPreview(nextPreview);
        } catch (err) {
          if (!didCancel) {
            setPreview(null);
            setPreviewError(err instanceof Error ? err.message : 'Preview failed.');
          }
        } finally {
          if (!didCancel) setIsPreviewLoading(false);
        }
      };
      void loadPreview();
    }, 300);

    return () => {
      didCancel = true;
      clearTimeout(timeoutId);
    };
  }, [normalizedRulesError, previewDynamicPlaylist, rules]);

  const saveDisabled = !name.trim() || normalizedRulesError !== null || isLoadingRules || isSaving;
  const status = previewStatus({
    isLoadingRules,
    isPreviewLoading,
    preview,
    normalizedRulesError,
    previewError,
  });

  const applyPreset = (nextRules: DynamicPlaylistRulesV1) => {
    const apply = () => setRules(normalizeDynamicPlaylistRules(nextRules));
    if (rulesAreDefault) {
      apply();
      return;
    }
    Alert.alert('Replace rules?', 'This preset will replace the current filters and result order.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Replace', style: 'destructive', onPress: apply },
    ]);
  };

  const openFieldPicker = (target: 'new' | ConditionEditorTarget) => {
    setSheet({ kind: 'field-picker', target });
  };

  const openConditionEditor = (index: number) => {
    setSheet({ kind: 'condition', target: { mode: 'edit', index, draft: rules.conditions[index] } });
  };

  const updateActiveConditionDraft = (condition: DynamicPlaylistCondition) => {
    setSheet((current) => {
      if (current?.kind !== 'condition') return current;
      if (current.target.mode === 'edit') {
        return { kind: 'condition', target: { mode: 'edit', index: current.target.index, draft: condition } };
      }
      return { kind: 'condition', target: { mode: 'new', draft: condition } };
    });
  };

  const selectField = (fieldKey: ConditionFieldKey) => {
    if (sheet?.kind !== 'field-picker') return;
    const draft = createDefaultCondition(fieldKey);
    if (sheet.target === 'new') {
      setSheet({ kind: 'condition', target: { mode: 'new', draft } });
      return;
    }
    if (sheet.target.mode === 'edit') {
      setSheet({ kind: 'condition', target: { mode: 'edit', index: sheet.target.index, draft } });
      return;
    }
    setSheet({ kind: 'condition', target: { mode: 'new', draft } });
  };

  const applyCondition = (target: ConditionEditorTarget) => {
    if (validateCondition(target.draft) !== null) return;
    const normalized = normalizeDynamicPlaylistCondition(target.draft);
    setRules((current) =>
      target.mode === 'new'
        ? { ...current, conditions: [...current.conditions, normalized] }
        : updateCondition(current, target.index, normalized)
    );
    setSheet(null);
  };

  const openSortSheet = () => {
    setSheet({
      kind: 'sort',
      draftSort: { ...rules.sort },
      limitText: rules.limit === null ? '' : String(rules.limit),
    });
  };

  const updateSortDraft = (draftSort: DynamicPlaylistSort) => {
    setSheet((current) => (current?.kind === 'sort' ? { ...current, draftSort } : current));
  };

  const updateLimitDraft = (limitText: string) => {
    setSheet((current) => (current?.kind === 'sort' ? { ...current, limitText } : current));
  };

  const applySort = () => {
    if (sheet?.kind !== 'sort') return;
    const trimmedLimit = sheet.limitText.trim();
    const parsedLimit = trimmedLimit ? Number(trimmedLimit) : null;
    if (parsedLimit !== null && (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 5000)) return;
    setRules((current) => ({
      ...current,
      sort: sheet.draftSort,
      limit: parsedLimit === null ? null : Math.trunc(parsedLimit),
    }));
    setSheet(null);
  };

  const save = () => {
    if (saveDisabled) return;
    void (async () => {
      setIsSaving(true);
      try {
        const normalizedRules = normalizeDynamicPlaylistRules(rules);
        const trimmedName = name.trim();
        if (isEditing && playlistId != null) {
          if (playlist && playlist.name !== trimmedName) {
            await renamePlaylist(playlistId, trimmedName);
          }
          await updateDynamicPlaylistRules(playlistId, normalizedRules);
          router.back();
          return;
        }

        const createdPlaylist = await createDynamicPlaylist(trimmedName, normalizedRules);
        router.replace(`/library/playlist/${createdPlaylist.id}`);
      } catch (err) {
        Alert.alert('Save failed', err instanceof Error ? err.message : String(err));
      } finally {
        setIsSaving(false);
      }
    })();
  };

  const renderSheet = () => {
    if (sheet === null) return null;

    if (sheet.kind === 'field-picker') {
      return (
        <AppSheet onClose={() => setSheet(null)}>
          <AppSheetTitle title="Choose filter" />
          {(['text', 'activity', 'library', 'audio'] as FieldGroup[]).map((group) => (
            <View key={group}>
              <AppSheetSection label={FIELD_GROUP_LABELS[group]} />
              {FIELD_OPTIONS.filter((option) => option.group === group).map((option) => (
                <AppSheetItem
                  key={option.key}
                  icon={option.icon}
                  label={option.label}
                  onPress={() => selectField(option.key)}
                />
              ))}
            </View>
          ))}
        </AppSheet>
      );
    }

    if (sheet.kind === 'condition') {
      const target = sheet.target;
      return (
        <ConditionEditorSheet
          target={target}
          onChangeDraft={updateActiveConditionDraft}
          onChangeField={() => openFieldPicker(target)}
          onRemove={() => {
            if (target.mode === 'edit') {
              setRules((current) => removeCondition(current, target.index));
            }
            setSheet(null);
          }}
          onCancel={() => setSheet(null)}
          onApply={() => applyCondition(target)}
        />
      );
    }

    if (sheet.kind === 'sort') {
      return (
        <SortLimitSheet
          sort={sheet.draftSort}
          limitText={sheet.limitText}
          onChangeSort={updateSortDraft}
          onChangeLimitText={updateLimitDraft}
          onCancel={() => setSheet(null)}
          onApply={applySort}
        />
      );
    }

    return (
      <PreviewSheet
        preview={preview}
        previewError={previewError}
        isLoading={isPreviewLoading}
        onClose={() => setSheet(null)}
      />
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.keyboardRoot}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen padded={false}>
        <View style={styles.header}>
          <Pressable android_ripple={ripple.bounded}
            onPress={() => router.back()}
            hitSlop={8}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </Pressable>
          <Text variant="heading" numberOfLines={1} style={styles.headerTitle}>
            {isEditing ? 'Edit dynamic playlist' : 'New dynamic playlist'}
          </Text>
          <View style={styles.headerButton} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <View style={styles.section}>
            <Text variant="caption" style={styles.sectionLabel}>
              NAME
            </Text>
            <TextInput
              style={styles.nameInput}
              value={name}
              onChangeText={setName}
              placeholder="Playlist name"
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.accent}
            />
          </View>

          <View style={styles.section}>
            <Text variant="caption" style={styles.sectionLabel}>
              STARTERS
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.presetRow}
            >
              {DYNAMIC_PLAYLIST_PRESETS.map((preset) => (
                <Pressable android_ripple={ripple.bounded}
                  key={preset.id}
                  style={styles.presetChip}
                  onPress={() => applyPreset(preset.rules)}
                  accessibilityRole="button"
                >
                  <Ionicons name="sparkles-outline" size={14} color={colors.accent} />
                  <Text variant="label" color={colors.accentText}>
                    {preset.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text variant="caption" style={styles.sectionLabel}>
                FILTERS
              </Text>
              <Pressable android_ripple={ripple.bounded} style={styles.inlineAction} onPress={() => openFieldPicker('new')} accessibilityRole="button">
                <Ionicons name="add" size={16} color={colors.accent} />
                <Text variant="label" color={colors.accent}>
                  Add filter
                </Text>
              </Pressable>
            </View>

            {rules.conditions.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="filter-outline" size={18} color={colors.textTertiary} />
                <Text variant="label" color={colors.textTertiary}>
                  No filters
                </Text>
              </View>
            ) : (
              <View style={styles.cardStack}>
                {rules.conditions.map((condition, index) => (
                  <FilterCard
                    key={`${getConditionFieldKey(condition)}-${index}`}
                    condition={condition}
                    onPress={() => openConditionEditor(index)}
                    onRemove={() => setRules((current) => removeCondition(current, index))}
                  />
                ))}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text variant="caption" style={styles.sectionLabel}>
              ORDER
            </Text>
            <Pressable android_ripple={ripple.bounded} style={styles.sortCard} onPress={openSortSheet} accessibilityRole="button">
              <View style={styles.cardIcon}>
                <Ionicons name="swap-vertical" size={18} color={colors.accent} />
              </View>
              <View style={styles.cardText}>
                <Text variant="body">Result order</Text>
                <Text variant="label" numberOfLines={1} color={colors.textSecondary}>
                  {describeSort(rules.sort, rules.limit)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </Pressable>
          </View>
        </ScrollView>

        <View style={styles.stickyBar}>
          <View style={styles.stickyMeta}>
            <Text variant="caption" color={colors.textTertiary}>
              PREVIEW
            </Text>
            <Text
              variant="body"
              numberOfLines={1}
              color={status.tone === 'warning' ? colors.warning : colors.textPrimary}
            >
              {status.label}
            </Text>
          </View>
          <Pressable android_ripple={ripple.bounded}
            style={[styles.previewButton, normalizedRulesError !== null && styles.disabled]}
            disabled={normalizedRulesError !== null}
            onPress={() => setSheet({ kind: 'preview' })}
            accessibilityRole="button"
          >
            <Ionicons name="eye-outline" size={18} color={colors.textSecondary} />
            <Text variant="label" color={colors.textSecondary}>
              Preview
            </Text>
          </Pressable>
          <Pressable android_ripple={ripple.bounded}
            style={[styles.saveButton, saveDisabled && styles.disabled]}
            disabled={saveDisabled}
            onPress={save}
            accessibilityRole="button"
          >
            <Text variant="label" color={colors.accentTextStrong}>
              {isSaving ? 'Saving' : 'Save'}
            </Text>
          </Pressable>
        </View>

        {renderSheet()}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const useStyles = createThemedStyles((colors) => ({
  keyboardRoot: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.base,
    textAlign: 'center',
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 124,
    gap: spacing.xl,
  },
  section: {
    gap: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  sectionLabel: {
    color: colors.textTertiary,
    letterSpacing: 1,
  },
  inlineAction: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  nameInput: {
    minHeight: 48,
    color: colors.textPrimary,
    fontFamily: fonts.sans.regular,
    fontSize: fontSize.base,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgTertiary,
  },
  presetRow: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  presetChip: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.glassBg,
  },
  cardStack: {
    gap: spacing.sm,
  },
  ruleCard: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgTertiary,
  },
  sortCard: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgTertiary,
  },
  emptyCard: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  cardIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentGlow,
  },
  cardText: {
    flex: 1,
    gap: 2,
  },
  cardRemove: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stickyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopColor: colors.glassBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.bgSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  stickyMeta: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  previewButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.md,
  },
  saveButton: {
    minHeight: 42,
    minWidth: 76,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.accentGlow,
  },
  disabled: {
    opacity: 0.45,
  },
  sheetSelectRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.glassBg,
  },
  sheetSelectText: {
    flex: 1,
    gap: 2,
  },
  sheetBlock: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  sheetInput: {
    minHeight: 48,
    color: colors.textPrimary,
    fontFamily: fonts.sans.regular,
    fontSize: fontSize.base,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  inputInvalid: {
    borderColor: colors.warning,
  },
  valueWithUnit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  valueInput: {
    flex: 1,
  },
  sheetHelp: {
    marginTop: spacing.xs,
  },
  sheetError: {
    marginTop: spacing.md,
  },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  sheetButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
  },
  cancelButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  applyButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
    backgroundColor: colors.accentGlow,
  },
  applyDisabled: {
    opacity: 0.4,
  },
  conditionSheetFooter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  removeButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.lg,
  },
  previewSheetList: {
    maxHeight: 360,
  },
  previewRow: {
    gap: 2,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  previewMessage: {
    paddingVertical: spacing.md,
  },
}));
