/**
 * SQLite connection with migrations and explicit transactions.
 *
 * Every state change runs inside `transaction`. Writes issued inside it are committed together or
 * not at all, which is how a state change and its event log entry stay in agreement (spec §2.2).
 * `BEGIN IMMEDIATE` takes the write lock at the start, so a read-decide-write sequence cannot
 * interleave with another writer.
 */
import { DatabaseSync } from "node:sqlite";
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from "./migrations.js";

export class SchemaVersionError extends Error {
  constructor(found: number) {
    super(
      `database schema version ${found} is newer than this build supports (${LATEST_SCHEMA_VERSION}); refusing to open it`,
    );
    this.name = "SchemaVersionError";
  }
}

export class WorkflowDatabase {
  private readonly db: DatabaseSync;
  private transactionDepth = 0;

  /** `location` is a file path, or `:memory:` for a throwaway database. */
  constructor(location: string) {
    this.db = new DatabaseSync(location);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    if (location !== ":memory:") {
      this.db.exec("PRAGMA journal_mode = WAL;");
    }
    this.migrate();
  }

  /** Prepares a statement against the connection. Callers keep the statement for reuse. */
  prepare(sql: string): ReturnType<DatabaseSync["prepare"]> {
    return this.db.prepare(sql);
  }

  /**
   * Runs `work` in one transaction. A nested call joins the outer transaction, so an error anywhere
   * rolls back everything from the outermost call.
   */
  transaction<T>(work: () => T): T {
    if (this.transactionDepth > 0) {
      return work();
    }
    this.db.exec("BEGIN IMMEDIATE");
    this.transactionDepth += 1;
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  schemaVersion(): number {
    const row = this.db.prepare("PRAGMA user_version").get() as
      | { user_version: number }
      | undefined;
    return row?.user_version ?? 0;
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    const current = this.schemaVersion();
    if (current > LATEST_SCHEMA_VERSION) {
      throw new SchemaVersionError(current);
    }
    for (const migration of MIGRATIONS) {
      if (migration.version <= current) {
        continue;
      }
      // user_version is transactional in SQLite, so the schema change and its version stamp commit together.
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(migration.sql);
        this.db.exec(`PRAGMA user_version = ${migration.version}`);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
  }
}
