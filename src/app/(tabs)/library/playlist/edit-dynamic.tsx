import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import {
  AppSheet,
  AppSheetItem,
  AppSheetTitle,
} from '@/components/sheets/AppSheet';
import { colors, fonts, fontSize, radius, spacing } from '@/theme';
import { usePlaylistStore } from '@/stores/playlistStore';
import {
  DYNAMIC_PLAYLIST_PRESETS,
  createDefaultDynamicPlaylistRules,
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
  type DynamicPlaylistSortField,
  type DynamicPlaylistSourceCondition,
  type DynamicPlaylistTextCondition,
  type DynamicPlaylistTextField,
} from '@/shared/playlists/dynamicPlaylist';

type ConditionFieldKey =
  `${DynamicPlaylistCondition['kind']}:${DynamicPlaylistTextField | DynamicPlaylistNumericField | DynamicPlaylistDateField | DynamicPlaylistExactField}`;

interface FieldOption {
  key: ConditionFieldKey;
  label: string;
}

type Picker = { kind: 'field'; index: number } | { kind: 'sort' } | null;

const FIELD_OPTIONS: readonly FieldOption[] = [
  { key: 'text:title', label: 'Title' },
  { key: 'text:artist', label: 'Artist' },
  { key: 'text:album', label: 'Album' },
  { key: 'text:album_artist', label: 'Album artist' },
  { key: 'text:genre', label: 'Genre' },
  { key: 'text:format', label: 'Format' },
  { key: 'text:musical_key', label: 'Key' },
  { key: 'numeric:play_count', label: 'Play count' },
  { key: 'numeric:year', label: 'Year' },
  { key: 'numeric:duration_seconds', label: 'Duration' },
  { key: 'numeric:bpm', label: 'BPM' },
  { key: 'date:last_played_at', label: 'Last played' },
  { key: 'date:added_at', label: 'Added' },
  { key: 'exact:favorite', label: 'Favorite' },
  { key: 'exact:source_type', label: 'Source' },
];

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

function createDefaultCondition(fieldKey: ConditionFieldKey = 'text:artist'): DynamicPlaylistCondition {
  const [kind, field] = fieldKey.split(':') as [DynamicPlaylistCondition['kind'], string];
  if (kind === 'numeric') {
    return {
      kind,
      field: field as DynamicPlaylistNumericField,
      operator: 'gte',
      value: field === 'play_count' ? 1 : 0,
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
  return FIELD_OPTIONS.find((option) => option.key === getConditionFieldKey(condition))?.label ?? condition.field;
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

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text variant="label" color={selected ? colors.accentTextStrong : colors.textSecondary}>
        {label}
      </Text>
    </Pressable>
  );
}

function OperatorChips({
  condition,
  onChange,
}: {
  condition: DynamicPlaylistCondition;
  onChange: (condition: DynamicPlaylistCondition) => void;
}) {
  if (condition.kind === 'text') {
    const options: [DynamicPlaylistTextCondition['operator'], string][] = [
      ['contains', 'Contains'],
      ['is', 'Is'],
      ['is_not', 'Is not'],
    ];
    return (
      <View style={styles.chipRow}>
        {options.map(([operator, label]) => (
          <Chip
            key={operator}
            label={label}
            selected={condition.operator === operator}
            onPress={() => onChange(updateTextOperator(condition, operator))}
          />
        ))}
      </View>
    );
  }

  if (condition.kind === 'numeric') {
    const options: [DynamicPlaylistNumericCondition['operator'], string][] = [
      ['eq', 'Is'],
      ['gte', 'At least'],
      ['lte', 'At most'],
    ];
    return (
      <View style={styles.chipRow}>
        {options.map(([operator, label]) => (
          <Chip
            key={operator}
            label={label}
            selected={condition.operator === operator}
            onPress={() => onChange(updateNumericOperator(condition, operator))}
          />
        ))}
      </View>
    );
  }

  if (condition.kind === 'date') {
    const options =
      condition.field === 'last_played_at'
        ? [
            ['never', 'Never'],
            ['within_days', 'Within'],
            ['not_within_days', 'Not within'],
          ]
        : [
            ['within_days', 'Within'],
            ['older_than_days', 'Older than'],
          ];
    return (
      <View style={styles.chipRow}>
        {options.map(([operator, label]) => (
          <Chip
            key={operator}
            label={label}
            selected={condition.operator === operator}
            onPress={() => onChange(updateDateOperator(condition, operator))}
          />
        ))}
      </View>
    );
  }

  const options: [DynamicPlaylistSourceCondition['operator'], string][] = [
    ['is', 'Is'],
    ['is_not', 'Is not'],
  ];
  return (
    <View style={styles.chipRow}>
      {options.map(([operator, label]) => (
        <Chip
          key={operator}
          label={label}
          selected={condition.operator === operator}
          onPress={() => onChange(updateExactOperator(condition, operator))}
        />
      ))}
    </View>
  );
}

function ConditionValue({
  condition,
  onChange,
}: {
  condition: DynamicPlaylistCondition;
  onChange: (condition: DynamicPlaylistCondition) => void;
}) {
  if (condition.kind === 'text') {
    return (
      <TextInput
        style={styles.input}
        value={condition.value}
        onChangeText={(value) => onChange({ ...condition, value })}
        placeholder="Value"
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.accent}
      />
    );
  }

  if (condition.kind === 'numeric') {
    return (
      <TextInput
        style={styles.input}
        value={Number.isFinite(condition.value) ? String(condition.value) : ''}
        onChangeText={(value) => onChange({ ...condition, value: Number(value) })}
        keyboardType="numeric"
        placeholder="0"
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.accent}
      />
    );
  }

  if (condition.kind === 'date') {
    if (condition.field === 'last_played_at' && condition.operator === 'never') return null;
    return (
      <TextInput
        style={styles.input}
        value={String(condition.value ?? 30)}
        onChangeText={(value) => onChange({ ...condition, value: Number(value) } as DynamicPlaylistCondition)}
        keyboardType="numeric"
        placeholder="Days"
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.accent}
      />
    );
  }

  if (condition.field === 'source_type') {
    const options: DynamicPlaylistSourceCondition['value'][] = ['local', 'subsonic', 'jellyfin'];
    return (
      <View style={styles.chipRow}>
        {options.map((value) => (
          <Chip
            key={value}
            label={value === 'local' ? 'Local' : value === 'subsonic' ? 'Subsonic' : 'Jellyfin'}
            selected={condition.value === value}
            onPress={() => onChange({ ...condition, value })}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.chipRow}>
      <Chip
        label="Yes"
        selected={condition.value}
        onPress={() => onChange({ ...condition, value: true })}
      />
      <Chip
        label="No"
        selected={!condition.value}
        onPress={() => onChange({ ...condition, value: false })}
      />
    </View>
  );
}

export default function DynamicPlaylistEditorScreen() {
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
  const [picker, setPicker] = useState<Picker>(null);
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

  useEffect(() => {
    let didCancel = false;
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
  }, [previewDynamicPlaylist, rules]);

  const saveDisabled = !name.trim() || normalizedRulesError !== null || isLoadingRules || isSaving;

  const addCondition = () => {
    setRules((current) => ({
      ...current,
      conditions: [...current.conditions, createDefaultCondition()],
    }));
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

  const renderPicker = () => {
    if (picker === null) return null;
    if (picker.kind === 'sort') {
      return (
        <AppSheet onClose={() => setPicker(null)}>
          <AppSheetTitle title="Sort by" />
          {Object.entries(SORT_LABELS).map(([field, label]) => (
            <AppSheetItem
              key={field}
              label={label}
              selected={rules.sort.field === field}
              onPress={() => {
                setRules((current) => ({
                  ...current,
                  sort: { ...current.sort, field: field as DynamicPlaylistSortField },
                }));
                setPicker(null);
              }}
            />
          ))}
        </AppSheet>
      );
    }

    return (
      <AppSheet onClose={() => setPicker(null)}>
        <AppSheetTitle title="Filter field" />
        {FIELD_OPTIONS.map((option) => (
          <AppSheetItem
            key={option.key}
            label={option.label}
            selected={getConditionFieldKey(rules.conditions[picker.index]) === option.key}
            onPress={() => {
              setRules((current) => updateCondition(current, picker.index, createDefaultCondition(option.key)));
              setPicker(null);
            }}
          />
        ))}
      </AppSheet>
    );
  };

  return (
    <Screen padded={false} style={styles.screen}>
      <View style={styles.header}>
        <Pressable
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
        <Pressable
          onPress={save}
          disabled={saveDisabled}
          hitSlop={8}
          style={[styles.headerSave, saveDisabled && styles.disabled]}
          accessibilityRole="button"
        >
          <Text variant="body" color={colors.accent}>
            {isSaving ? 'Saving' : 'Save'}
          </Text>
        </Pressable>
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
            style={styles.input}
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
          <View style={styles.chipRow}>
            {DYNAMIC_PLAYLIST_PRESETS.map((preset) => (
              <Chip key={preset.id} label={preset.label} onPress={() => setRules(preset.rules)} />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text variant="caption" style={styles.sectionLabel}>
              FILTERS
            </Text>
            <View style={styles.inlineActions}>
              <Pressable onPress={() => setRules(createDefaultDynamicPlaylistRules())} accessibilityRole="button">
                <Text variant="label" color={colors.textSecondary}>
                  Reset
                </Text>
              </Pressable>
              <Pressable onPress={addCondition} accessibilityRole="button">
                <Text variant="label" color={colors.accent}>
                  Add
                </Text>
              </Pressable>
            </View>
          </View>

          {rules.conditions.length === 0 ? (
            <Text variant="label" color={colors.textTertiary} style={styles.emptyLine}>
              No filters
            </Text>
          ) : null}

          {rules.conditions.map((condition, index) => (
            <View key={index} style={styles.condition}>
              <View style={styles.conditionHeader}>
                <Pressable
                  style={styles.fieldButton}
                  onPress={() => setPicker({ kind: 'field', index })}
                  accessibilityRole="button"
                >
                  <Text variant="body" color={colors.textPrimary}>
                    {fieldLabel(condition)}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
                </Pressable>
                <Pressable
                  onPress={() => setRules((current) => removeCondition(current, index))}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Remove filter"
                >
                  <Ionicons name="close" size={20} color={colors.textTertiary} />
                </Pressable>
              </View>
              <OperatorChips
                condition={condition}
                onChange={(next) => setRules((current) => updateCondition(current, index, next))}
              />
              <ConditionValue
                condition={condition}
                onChange={(next) => setRules((current) => updateCondition(current, index, next))}
              />
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text variant="caption" style={styles.sectionLabel}>
            SORT
          </Text>
          <Pressable style={styles.fieldButton} onPress={() => setPicker({ kind: 'sort' })} accessibilityRole="button">
            <Text variant="body">{SORT_LABELS[rules.sort.field]}</Text>
            <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
          </Pressable>
          <View style={styles.chipRow}>
            <Chip
              label="Ascending"
              selected={rules.sort.direction === 'asc'}
              onPress={() => setRules((current) => ({ ...current, sort: { ...current.sort, direction: 'asc' } }))}
            />
            <Chip
              label="Descending"
              selected={rules.sort.direction === 'desc'}
              onPress={() => setRules((current) => ({ ...current, sort: { ...current.sort, direction: 'desc' } }))}
            />
          </View>
          <TextInput
            style={styles.input}
            value={rules.limit === null ? '' : String(rules.limit)}
            onChangeText={(value) =>
              setRules((current) => ({
                ...current,
                limit: value.trim() ? Number(value) : null,
              }))
            }
            keyboardType="numeric"
            placeholder="Limit"
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.accent}
          />
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text variant="caption" style={styles.sectionLabel}>
              PREVIEW
            </Text>
            <Text variant="label" color={colors.textSecondary}>
              {isPreviewLoading ? 'Loading' : `${preview?.track_count ?? 0} tracks`}
            </Text>
          </View>
          {previewError || normalizedRulesError ? (
            <Text variant="label" color={colors.warning} style={styles.errorText}>
              {previewError ?? normalizedRulesError}
            </Text>
          ) : preview?.tracks.length ? (
            <View style={styles.previewList}>
              {preview.tracks.slice(0, 8).map((track) => (
                <View key={track.path} style={styles.previewRow}>
                  <Text variant="body" numberOfLines={1}>
                    {track.title}
                  </Text>
                  <Text variant="label" numberOfLines={1} color={colors.textSecondary}>
                    {[track.artist, track.album].filter(Boolean).join(' / ')}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text variant="label" color={colors.textTertiary} style={styles.emptyLine}>
              No matches
            </Text>
          )}
        </View>
      </ScrollView>

      {picker !== null ? renderPicker() : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingTop: 0,
  },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.base,
  },
  headerSave: {
    minWidth: 54,
    alignItems: 'flex-end',
    paddingVertical: spacing.sm,
  },
  disabled: {
    opacity: 0.45,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
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
  inlineActions: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  input: {
    minHeight: 44,
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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: 34,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.glassBg,
  },
  chipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentGlow,
  },
  condition: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  conditionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  fieldButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bgTertiary,
  },
  emptyLine: {
    paddingVertical: spacing.sm,
  },
  errorText: {
    paddingVertical: spacing.sm,
  },
  previewList: {
    borderTopColor: colors.glassBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  previewRow: {
    gap: 2,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
