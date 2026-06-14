// SQLite access layer — ports the desktop `LibrarySqliteDatabase` wrapper
// (astra/src/main/services/library.ts) onto op-sqlite. Same method surface so
// desktop SQL ports verbatim; methods are async because op-sqlite is async.

import { open, type DB, type QueryResult, type Scalar, type Transaction } from '@op-engineering/op-sqlite';
import { migrate } from './schema';

export type SqlParams = Scalar[];

interface Executor {
  execute: (query: string, params?: Scalar[]) => Promise<QueryResult>;
}

// op-sqlite (16.2.x under RN 0.85 / Hermes) truncates each UTF-16 code unit of a
// bound *string* parameter to its low byte, corrupting any non-Latin1 text (CJK,
// emoji, accents beyond U+00FF). Work around it by binding the UTF-8 bytes mapped
// 1:1 into a Latin-1 string: the low-byte truncation then yields exactly those
// bytes — i.e. valid UTF-8 in the column. op-sqlite's read path decodes UTF-8
// correctly, so reads need no change; applying this to every string param (stored
// values and WHERE comparisons alike) keeps writes and lookups consistent.
// Remove if/when op-sqlite binds UTF-8 strings correctly on this RN/Hermes ABI.
function toUtf8Latin1(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      out += String.fromCharCode(c);
    } else if (c < 0x800) {
      out += String.fromCharCode(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff) {
      const lo = s.charCodeAt(++i); // surrogate pair → astral code point (emoji)
      const cp = 0x10000 + ((c & 0x3ff) << 10) + (lo & 0x3ff);
      out += String.fromCharCode(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    } else {
      out += String.fromCharCode(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return out;
}

function encodeParams(params: SqlParams): SqlParams {
  let hasString = false;
  for (const p of params) {
    if (typeof p === 'string') {
      hasString = true;
      break;
    }
  }
  if (!hasString) return params;
  return params.map((p) => (typeof p === 'string' ? toUtf8Latin1(p) : p));
}

export class LibraryDatabase {
  constructor(
    private readonly executor: Executor,
    private readonly db: DB | null = null
  ) {}

  async run(sql: string, params: SqlParams = []): Promise<{ changes: number; lastInsertRowid: number }> {
    const result = await this.executor.execute(sql, encodeParams(params));
    return { changes: result.rowsAffected, lastInsertRowid: result.insertId ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.executor.execute(sql);
  }

  async get<T>(sql: string, params: SqlParams = []): Promise<T | undefined> {
    const result = await this.executor.execute(sql, encodeParams(params));
    return result.rows[0] as T | undefined;
  }

  async all<T>(sql: string, params: SqlParams = []): Promise<T[]> {
    const result = await this.executor.execute(sql, encodeParams(params));
    return result.rows as T[];
  }

  /**
   * Runs `fn` inside a single transaction; op-sqlite commits on resolve and
   * rolls back on throw. The callback receives a LibraryDatabase scoped to the
   * transaction — nesting is not supported.
   */
  async transaction(fn: (tx: LibraryDatabase) => Promise<void>): Promise<void> {
    if (!this.db) {
      throw new Error('Nested transactions are not supported');
    }
    await this.db.transaction(async (tx: Transaction) => {
      await fn(new LibraryDatabase(tx));
    });
  }

  close(): void {
    this.db?.close();
  }
}

let dbPromise: Promise<LibraryDatabase> | null = null;

async function doOpen(): Promise<LibraryDatabase> {
  const raw = open({ name: 'astra-library.db' });
  const db = new LibraryDatabase(raw, raw);
  await db.exec('PRAGMA journal_mode = WAL');
  await db.exec('PRAGMA foreign_keys = ON');
  await migrate(db);
  return db;
}

/** Opens (once) and migrates the library database. */
export function openLibraryDb(): Promise<LibraryDatabase> {
  if (!dbPromise) {
    dbPromise = doOpen().catch((err) => {
      dbPromise = null; // allow retry on genuine failure
      throw err;
    });
  }
  return dbPromise;
}
