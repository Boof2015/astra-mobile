export type PlaylistKind = 'normal' | 'dynamic';

export type DynamicPlaylistTextField =
  | 'title'
  | 'artist'
  | 'album'
  | 'album_artist'
  | 'genre'
  | 'format'
  | 'musical_key';

export type DynamicPlaylistExactField = 'source_type' | 'favorite';
export type DynamicPlaylistNumericField = 'play_count' | 'year' | 'duration_seconds' | 'bpm';
export type DynamicPlaylistDateField = 'last_played_at' | 'added_at';
export type DynamicPlaylistSortField =
  | 'title'
  | 'artist'
  | 'album'
  | 'added_at'
  | 'last_played_at'
  | 'play_count'
  | 'year'
  | 'duration_seconds'
  | 'bpm';

export type DynamicPlaylistTextOperator = 'contains' | 'is' | 'is_not';
export type DynamicPlaylistExactOperator = 'is' | 'is_not';
export type DynamicPlaylistNumericOperator = 'eq' | 'gte' | 'lte';
export type DynamicPlaylistLastPlayedOperator = 'never' | 'within_days' | 'not_within_days';
export type DynamicPlaylistAddedAtOperator = 'within_days' | 'older_than_days';
export type DynamicPlaylistSourceType = 'local' | 'subsonic' | 'jellyfin';
export type DynamicPlaylistSortDirection = 'asc' | 'desc';

export interface DynamicPlaylistTextCondition {
  kind: 'text';
  field: DynamicPlaylistTextField;
  operator: DynamicPlaylistTextOperator;
  value: string;
}

export interface DynamicPlaylistSourceCondition {
  kind: 'exact';
  field: 'source_type';
  operator: DynamicPlaylistExactOperator;
  value: DynamicPlaylistSourceType;
}

export interface DynamicPlaylistFavoriteCondition {
  kind: 'exact';
  field: 'favorite';
  operator: DynamicPlaylistExactOperator;
  value: boolean;
}

export interface DynamicPlaylistNumericCondition {
  kind: 'numeric';
  field: DynamicPlaylistNumericField;
  operator: DynamicPlaylistNumericOperator;
  value: number;
}

export interface DynamicPlaylistLastPlayedCondition {
  kind: 'date';
  field: 'last_played_at';
  operator: DynamicPlaylistLastPlayedOperator;
  value?: number;
}

export interface DynamicPlaylistAddedAtCondition {
  kind: 'date';
  field: 'added_at';
  operator: DynamicPlaylistAddedAtOperator;
  value: number;
}

export type DynamicPlaylistCondition =
  | DynamicPlaylistTextCondition
  | DynamicPlaylistSourceCondition
  | DynamicPlaylistFavoriteCondition
  | DynamicPlaylistNumericCondition
  | DynamicPlaylistLastPlayedCondition
  | DynamicPlaylistAddedAtCondition;

export interface DynamicPlaylistSort {
  field: DynamicPlaylistSortField;
  direction: DynamicPlaylistSortDirection;
}

export interface DynamicPlaylistRulesV1 {
  version: 1;
  conditions: DynamicPlaylistCondition[];
  sort: DynamicPlaylistSort;
  limit: number | null;
}

export interface DynamicPlaylistPreview {
  track_count: number;
  tracks: {
    path: string;
    title: string;
    artist: string;
    album: string;
  }[];
}

export interface DynamicPlaylistPreset {
  id: string;
  label: string;
  rules: DynamicPlaylistRulesV1;
}


export type DynamicPlaylistMatch = 'all' | 'any'
export interface DynamicPlaylistGroup {
  kind: 'group'
  match: DynamicPlaylistMatch
  children: DynamicPlaylistNode[]
}
export type DynamicPlaylistNode = DynamicPlaylistCondition | DynamicPlaylistGroup
export interface DynamicPlaylistRulesV2 {
  version: 2
  filter: DynamicPlaylistGroup
  sort: DynamicPlaylistSort
  limit: number | null
}
export type DynamicPlaylistRules = DynamicPlaylistRulesV1 | DynamicPlaylistRulesV2
export const DYNAMIC_PLAYLIST_MAX_GROUP_DEPTH = 8
export const DYNAMIC_PLAYLIST_MAX_NODES = 256

export const DYNAMIC_PLAYLIST_TEXT_FIELDS: readonly DynamicPlaylistTextField[] = [
  'title',
  'artist',
  'album',
  'album_artist',
  'genre',
  'format',
  'musical_key',
];

export const DYNAMIC_PLAYLIST_NUMERIC_FIELDS: readonly DynamicPlaylistNumericField[] = [
  'play_count',
  'year',
  'duration_seconds',
  'bpm',
];

export const DYNAMIC_PLAYLIST_DATE_FIELDS: readonly DynamicPlaylistDateField[] = [
  'last_played_at',
  'added_at',
];

export const DYNAMIC_PLAYLIST_EXACT_FIELDS: readonly DynamicPlaylistExactField[] = [
  'source_type',
  'favorite',
];

export const DYNAMIC_PLAYLIST_SORT_FIELDS: readonly DynamicPlaylistSortField[] = [
  'title',
  'artist',
  'album',
  'added_at',
  'last_played_at',
  'play_count',
  'year',
  'duration_seconds',
  'bpm',
];

export const DYNAMIC_PLAYLIST_SOURCE_TYPES: readonly DynamicPlaylistSourceType[] = [
  'local',
  'subsonic',
  'jellyfin',
];

export const DEFAULT_DYNAMIC_PLAYLIST_SORT: DynamicPlaylistSort = {
  field: 'title',
  direction: 'asc',
};

export function createDefaultDynamicPlaylistRules(): DynamicPlaylistRulesV2 {
  return {
    version: 2,
    filter: { kind: 'group', match: 'all', children: [] },
    sort: { ...DEFAULT_DYNAMIC_PLAYLIST_SORT },
    limit: null,
  };
}

export const DYNAMIC_PLAYLIST_PRESETS: readonly DynamicPlaylistPreset[] = [
  {
    id: 'unplayed',
    label: 'Unplayed',
    rules: {
      version: 1,
      conditions: [{ kind: 'numeric', field: 'play_count', operator: 'eq', value: 0 }],
      sort: { field: 'title', direction: 'asc' },
      limit: null,
    },
  },
  {
    id: 'recently-added',
    label: 'Recently added',
    rules: {
      version: 1,
      conditions: [{ kind: 'date', field: 'added_at', operator: 'within_days', value: 30 }],
      sort: { field: 'added_at', direction: 'desc' },
      limit: null,
    },
  },
  {
    id: 'favorites',
    label: 'Favorites',
    rules: {
      version: 1,
      conditions: [{ kind: 'exact', field: 'favorite', operator: 'is', value: true }],
      sort: { field: 'title', direction: 'asc' },
      limit: null,
    },
  },
  {
    id: 'most-played',
    label: 'Most played',
    rules: {
      version: 1,
      conditions: [{ kind: 'numeric', field: 'play_count', operator: 'gte', value: 1 }],
      sort: { field: 'play_count', direction: 'desc' },
      limit: 100,
    },
  },
  {
    id: 'not-recently',
    label: 'Not played recently',
    rules: {
      version: 1,
      conditions: [{ kind: 'date', field: 'last_played_at', operator: 'not_within_days', value: 30 }],
      sort: { field: 'last_played_at', direction: 'asc' },
      limit: null,
    },
  },
  {
    id: 'local-only',
    label: 'Local only',
    rules: {
      version: 1,
      conditions: [{ kind: 'exact', field: 'source_type', operator: 'is', value: 'local' }],
      sort: { field: 'title', direction: 'asc' },
      limit: null,
    },
  },
];

const TEXT_OPERATORS: readonly DynamicPlaylistTextOperator[] = ['contains', 'is', 'is_not'];
const EXACT_OPERATORS: readonly DynamicPlaylistExactOperator[] = ['is', 'is_not'];
const NUMERIC_OPERATORS: readonly DynamicPlaylistNumericOperator[] = ['eq', 'gte', 'lte'];
const LAST_PLAYED_OPERATORS: readonly DynamicPlaylistLastPlayedOperator[] = [
  'never',
  'within_days',
  'not_within_days',
];
const ADDED_AT_OPERATORS: readonly DynamicPlaylistAddedAtOperator[] = [
  'within_days',
  'older_than_days',
];
const SORT_DIRECTIONS: readonly DynamicPlaylistSortDirection[] = ['asc', 'desc'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string.`);
  }
  return value;
}

function requireArrayMember<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fieldName: string
): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`${fieldName} is not supported.`);
}

function normalizePositiveInteger(value: unknown, fieldName: string): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 1) {
    throw new Error(`${fieldName} must be a positive number.`);
  }
  return Math.trunc(numberValue);
}

function normalizeNumericValue(value: unknown, fieldName: DynamicPlaylistNumericField): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`${fieldName} must be a number.`);
  }
  if (fieldName === 'year') return Math.trunc(numberValue);
  return numberValue;
}

function normalizeTextCondition(condition: Record<string, unknown>): DynamicPlaylistTextCondition {
  const field = requireArrayMember(condition.field, DYNAMIC_PLAYLIST_TEXT_FIELDS, 'Text field');
  const operator = requireArrayMember(condition.operator, TEXT_OPERATORS, 'Text operator');
  const value = requireString(condition.value, 'Text value').trim();
  if (!value) {
    throw new Error('Text value is required.');
  }
  return { kind: 'text', field, operator, value };
}

function normalizeExactCondition(
  condition: Record<string, unknown>
): DynamicPlaylistSourceCondition | DynamicPlaylistFavoriteCondition {
  const field = requireArrayMember(condition.field, DYNAMIC_PLAYLIST_EXACT_FIELDS, 'Exact field');
  const operator = requireArrayMember(condition.operator, EXACT_OPERATORS, 'Exact operator');

  if (field === 'source_type') {
    const value = requireArrayMember(condition.value, DYNAMIC_PLAYLIST_SOURCE_TYPES, 'Source type');
    return { kind: 'exact', field, operator, value };
  }

  if (typeof condition.value !== 'boolean') {
    throw new Error('Favorite value must be true or false.');
  }
  return { kind: 'exact', field, operator, value: condition.value };
}

function normalizeNumericCondition(condition: Record<string, unknown>): DynamicPlaylistNumericCondition {
  const field = requireArrayMember(condition.field, DYNAMIC_PLAYLIST_NUMERIC_FIELDS, 'Numeric field');
  const operator = requireArrayMember(condition.operator, NUMERIC_OPERATORS, 'Numeric operator');
  const value = normalizeNumericValue(condition.value, field);
  return { kind: 'numeric', field, operator, value };
}

function normalizeDateCondition(
  condition: Record<string, unknown>
): DynamicPlaylistLastPlayedCondition | DynamicPlaylistAddedAtCondition {
  const field = requireArrayMember(condition.field, DYNAMIC_PLAYLIST_DATE_FIELDS, 'Date field');

  if (field === 'last_played_at') {
    const operator = requireArrayMember(condition.operator, LAST_PLAYED_OPERATORS, 'Last played operator');
    if (operator === 'never') {
      return { kind: 'date', field, operator };
    }
    return {
      kind: 'date',
      field,
      operator,
      value: normalizePositiveInteger(condition.value, 'Day value'),
    };
  }

  const operator = requireArrayMember(condition.operator, ADDED_AT_OPERATORS, 'Added date operator');
  return {
    kind: 'date',
    field,
    operator,
    value: normalizePositiveInteger(condition.value, 'Day value'),
  };
}

export function normalizeDynamicPlaylistCondition(value: unknown): DynamicPlaylistCondition {
  if (!isRecord(value)) {
    throw new Error('Dynamic playlist condition must be an object.');
  }

  const kind = requireArrayMember(value.kind, ['text', 'exact', 'numeric', 'date'] as const, 'Condition kind');
  if (kind === 'text') return normalizeTextCondition(value);
  if (kind === 'exact') return normalizeExactCondition(value);
  if (kind === 'numeric') return normalizeNumericCondition(value);
  return normalizeDateCondition(value);
}

export function normalizeDynamicPlaylistSort(value: unknown): DynamicPlaylistSort {
  if (!isRecord(value)) return { ...DEFAULT_DYNAMIC_PLAYLIST_SORT };
  return {
    field: requireArrayMember(value.field, DYNAMIC_PLAYLIST_SORT_FIELDS, 'Sort field'),
    direction: requireArrayMember(value.direction, SORT_DIRECTIONS, 'Sort direction'),
  };
}

export function normalizeDynamicPlaylistRules(value: unknown): DynamicPlaylistRulesV2 {
  if (!isRecord(value)) throw new Error('Dynamic playlist rules must be an object.')
  if (value.version !== 1 && value.version !== 2) {
    throw new Error('Dynamic playlist rule version is not supported.')
  }
  let nodeCount = 0
  const normalizeNode = (raw: unknown, depth: number): DynamicPlaylistNode => {
    if (++nodeCount > DYNAMIC_PLAYLIST_MAX_NODES) {
      throw new Error(`Use at most ${DYNAMIC_PLAYLIST_MAX_NODES} filter nodes.`)
    }
    if (!isRecord(raw)) throw new Error('Dynamic playlist filter must be an object.')
    if (raw.kind !== 'group') return normalizeDynamicPlaylistCondition(raw)
    if (depth > DYNAMIC_PLAYLIST_MAX_GROUP_DEPTH) {
      throw new Error(`Use at most ${DYNAMIC_PLAYLIST_MAX_GROUP_DEPTH} group levels.`)
    }
    const match = requireArrayMember(raw.match, ['all', 'any'] as const, 'Group match')
    if (!Array.isArray(raw.children)) throw new Error('Group children must be an array.')
    if (depth > 1 && raw.children.length === 0) {
      throw new Error('Add a filter to each group, or remove the empty group.')
    }
    return { kind: 'group', match, children: raw.children.map((child) => normalizeNode(child, depth + 1)) }
  }
  if (value.version === 1 && !Array.isArray(value.conditions)) {
    throw new Error('Dynamic playlist conditions must be an array.')
  }
  // A version 1 list contains only leaves: accepting groups here would silently
  // change the meaning when an older app reads this same JSON.
  const rawRoot = value.version === 1
    ? { kind: 'group', match: 'all', children: (value.conditions as unknown[]).map(normalizeDynamicPlaylistCondition) }
    : value.filter
  if (!isRecord(rawRoot) || rawRoot.kind !== 'group') throw new Error('A root filter group is required.')
  const filter = normalizeNode(rawRoot, 1) as DynamicPlaylistGroup
  const limit = value.limit === null || typeof value.limit === 'undefined'
    ? null : normalizePositiveInteger(value.limit, 'Result limit')
  if (limit !== null && limit > 5000) throw new Error('Result limit must be 5000 or less.')
  return { version: 2, filter, sort: normalizeDynamicPlaylistSort(value.sort), limit }
}

/** Keep simple playlists readable by existing desktop and mobile releases. */
export function serializeDynamicPlaylistRules(value: DynamicPlaylistRules): string {
  const rules = normalizeDynamicPlaylistRules(value)
  if (rules.filter.match === 'all' && rules.filter.children.every((node) => node.kind !== 'group')) {
    return JSON.stringify({ version: 1, conditions: rules.filter.children, sort: rules.sort, limit: rules.limit })
  }
  return JSON.stringify(rules)
}

export function dynamicPlaylistConditions(group: DynamicPlaylistGroup): DynamicPlaylistCondition[] {
  return group.children.flatMap((node) => node.kind === 'group' ? dynamicPlaylistConditions(node) : [node])
}
