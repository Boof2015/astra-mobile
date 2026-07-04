import type {
  DynamicPlaylistCondition,
  DynamicPlaylistDateField,
  DynamicPlaylistNumericField,
  DynamicPlaylistRulesV1,
  DynamicPlaylistSortField,
  DynamicPlaylistTextField,
} from '../shared/playlists/dynamicPlaylist';

export interface DynamicPlaylistWhere {
  joins: string;
  where: string;
  params: (string | number | null)[];
}

export interface DynamicPlaylistOrderField {
  expression: string;
  nullable: boolean;
  text?: boolean;
}

const DYNAMIC_TEXT_FIELD_SQL: Record<DynamicPlaylistTextField, string> = {
  title: 't.title',
  artist: 't.artist',
  album: 't.album',
  album_artist: 't.album_artist',
  genre: 't.genre',
  format: 't.format',
  musical_key: 't.musical_key',
};

const DYNAMIC_NUMERIC_FIELD_SQL: Record<DynamicPlaylistNumericField, string> = {
  play_count: 'COALESCE(t.play_count, 0)',
  year: 't.year',
  duration_seconds: 't.duration',
  bpm: 't.bpm',
};

const DYNAMIC_DATE_FIELD_SQL: Record<DynamicPlaylistDateField, string> = {
  last_played_at: 't.last_played_at',
  added_at: 't.added_at',
};

export const DYNAMIC_SORT_FIELD_SQL: Record<DynamicPlaylistSortField, DynamicPlaylistOrderField> = {
  title: { expression: 't.title', nullable: false, text: true },
  artist: { expression: 't.artist', nullable: false, text: true },
  album: { expression: 't.album', nullable: false, text: true },
  added_at: { expression: 't.added_at', nullable: false },
  last_played_at: { expression: 't.last_played_at', nullable: true },
  play_count: { expression: 'COALESCE(t.play_count, 0)', nullable: false },
  year: { expression: 't.year', nullable: true },
  duration_seconds: { expression: 't.duration', nullable: false },
  bpm: { expression: 't.bpm', nullable: true },
};

function appendDynamicTextCondition(
  condition: Extract<DynamicPlaylistCondition, { kind: 'text' }>,
  whereClauses: string[],
  params: (string | number | null)[]
): void {
  const expression = DYNAMIC_TEXT_FIELD_SQL[condition.field];
  const normalizedValue = condition.value.toLocaleLowerCase();
  if (condition.operator === 'contains') {
    whereClauses.push(`LOWER(COALESCE(${expression}, '')) LIKE ?`);
    params.push(`%${normalizedValue}%`);
    return;
  }

  whereClauses.push(`LOWER(COALESCE(${expression}, '')) ${condition.operator === 'is' ? '=' : '<>'} ?`);
  params.push(normalizedValue);
}

function appendDynamicExactCondition(
  condition: Extract<DynamicPlaylistCondition, { kind: 'exact' }>,
  whereClauses: string[],
  params: (string | number | null)[]
): void {
  if (condition.field === 'source_type') {
    whereClauses.push(`t.source_type ${condition.operator === 'is' ? '=' : '<>'} ?`);
    params.push(condition.value);
    return;
  }

  const expectsFavorite = condition.operator === 'is' ? condition.value : !condition.value;
  whereClauses.push(`f.track_path IS ${expectsFavorite ? 'NOT NULL' : 'NULL'}`);
}

function appendDynamicNumericCondition(
  condition: Extract<DynamicPlaylistCondition, { kind: 'numeric' }>,
  whereClauses: string[],
  params: (string | number | null)[]
): void {
  const expression = DYNAMIC_NUMERIC_FIELD_SQL[condition.field];
  const operator = condition.operator === 'eq' ? '=' : condition.operator === 'gte' ? '>=' : '<=';
  whereClauses.push(`${expression} ${operator} ?`);
  params.push(condition.value);
}

function appendDynamicDateCondition(
  condition: Extract<DynamicPlaylistCondition, { kind: 'date' }>,
  whereClauses: string[],
  params: (string | number | null)[],
  now: number
): void {
  const expression = DYNAMIC_DATE_FIELD_SQL[condition.field];
  if (condition.field === 'last_played_at' && condition.operator === 'never') {
    whereClauses.push(`${expression} IS NULL`);
    return;
  }

  const dayValue = typeof condition.value === 'number' ? condition.value : 1;
  const cutoff = now - dayValue * 24 * 60 * 60 * 1000;
  if (condition.field === 'last_played_at') {
    if (condition.operator === 'within_days') {
      whereClauses.push(`${expression} >= ?`);
      params.push(cutoff);
      return;
    }
    whereClauses.push(`(${expression} IS NULL OR ${expression} < ?)`);
    params.push(cutoff);
    return;
  }

  whereClauses.push(`${expression} ${condition.operator === 'within_days' ? '>=' : '<'} ?`);
  params.push(cutoff);
}

export function buildDynamicPlaylistWhereClause(
  rules: DynamicPlaylistRulesV1,
  now: number = Date.now()
): DynamicPlaylistWhere {
  const whereClauses: string[] = [];
  const params: (string | number | null)[] = [];
  const needsFavoriteJoin = rules.conditions.some(
    (condition) => condition.kind === 'exact' && condition.field === 'favorite'
  );

  for (const condition of rules.conditions) {
    if (condition.kind === 'text') {
      appendDynamicTextCondition(condition, whereClauses, params);
    } else if (condition.kind === 'exact') {
      appendDynamicExactCondition(condition, whereClauses, params);
    } else if (condition.kind === 'numeric') {
      appendDynamicNumericCondition(condition, whereClauses, params);
    } else {
      appendDynamicDateCondition(condition, whereClauses, params, now);
    }
  }

  return {
    joins: needsFavoriteJoin ? 'LEFT JOIN favorites f ON f.track_path = t.path' : '',
    where: whereClauses.length > 0 ? whereClauses.join('\n      AND ') : '1 = 1',
    params,
  };
}

export function buildDynamicPlaylistOrderByClause(rules: DynamicPlaylistRulesV1): string {
  const sort = DYNAMIC_SORT_FIELD_SQL[rules.sort.field] ?? DYNAMIC_SORT_FIELD_SQL.title;
  const direction = rules.sort.direction === 'desc' ? 'DESC' : 'ASC';
  const expression = sort.text ? `${sort.expression} COLLATE NOCASE` : sort.expression;
  const nullablePrefix = sort.nullable
    ? `CASE WHEN ${sort.expression} IS NULL THEN 1 ELSE 0 END ASC, `
    : '';
  return `${nullablePrefix}${expression} ${direction}, t.path COLLATE NOCASE ASC`;
}
