// SQLite access layer — ports the desktop `LibrarySqliteDatabase` wrapper
// (astra/src/main/services/library.ts) onto op-sqlite. Same method surface so
// desktop SQL ports verbatim; methods are async because op-sqlite is async.

import { open, type DB, type QueryResult, type Scalar, type Transaction } from '@op-engineering/op-sqlite';
import { migrate } from './schema';

export type SqlParams = Scalar[];

interface Executor {
  execute: (query: string, params?: Scalar[]) => Promise<QueryResult>;
}

export class LibraryDatabase {
  constructor(
    private readonly executor: Executor,
    private readonly db: DB | null = null
  ) {}

  async run(sql: string, params: SqlParams = []): Promise<{ changes: number; lastInsertRowid: number }> {
    const result = await this.executor.execute(sql, params);
    return { changes: result.rowsAffected, lastInsertRowid: result.insertId ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.executor.execute(sql);
  }

  async get<T>(sql: string, params: SqlParams = []): Promise<T | undefined> {
    const result = await this.executor.execute(sql, params);
    return result.rows[0] as T | undefined;
  }

  async all<T>(sql: string, params: SqlParams = []): Promise<T[]> {
    const result = await this.executor.execute(sql, params);
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
