/**
 * SQLite connection with migrations and explicit transactions.
 *
 * Every state change runs inside `transaction`. Writes issued inside it are committed together or
 * not at all, which is how a state change and its event log entry stay in agreement (spec §2.2).
 * `BEGIN IMMEDIATE` takes the write lock at the start, so a read-decide-write sequence cannot
 * interleave with another writer.
 */
import { closeSync, lstatSync, openSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
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

export class InstanceLockError extends Error {
  constructor() {
    super("another runner owns this state database; close it before starting another writer");
    this.name = "InstanceLockError";
  }
}

export class WorkflowDatabase {
  private readonly db: DatabaseSync;
  private readonly lease: DatabaseSync | undefined;
  readonly readOnly: boolean;
  private transactionDepth = 0;
  private transactionFailure: { readonly error: unknown } | undefined;

  /** `location` is a file path, or `:memory:` for a throwaway database. */
  constructor(location: string, options: { readonly readOnly?: boolean } = {}) {
    this.readOnly = options.readOnly ?? false;
    const file = location === ":memory:" ? location : canonicalPath(location);
    this.lease = file === ":memory:" || this.readOnly ? undefined : acquireLease(file);
    let connection: DatabaseSync | undefined;
    try {
      connection = new DatabaseSync(file, { readOnly: this.readOnly });
      this.db = connection;
      this.db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
      if (this.readOnly) {
        const version = this.schemaVersion();
        if (version > LATEST_SCHEMA_VERSION) throw new SchemaVersionError(version);
        if (version !== LATEST_SCHEMA_VERSION)
          throw new Error(
            "state database needs migration; open a writer before read-only inspection",
          );
      } else {
        if (file !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL;");
        this.migrate();
      }
    } catch (error) {
      connection?.close();
      this.lease?.close();
      throw error;
    }
  }

  /** Prepares a statement against the connection. Callers keep the statement for reuse. */
  prepare(sql: string): ReturnType<DatabaseSync["prepare"]> {
    return this.db.prepare(sql);
  }

  /**
   * Runs `work` in one transaction. A nested call joins the outer transaction, so an error anywhere
   * rolls back everything from the outermost call, even if its caller catches the inner error.
   */
  transaction<T>(work: () => T): T {
    if (this.transactionDepth > 0) {
      try {
        return work();
      } catch (error) {
        this.transactionFailure ??= { error };
        throw error;
      }
    }
    this.db.exec(this.readOnly ? "BEGIN" : "BEGIN IMMEDIATE");
    this.transactionDepth += 1;
    try {
      const result = work();
      if (this.transactionFailure) {
        throw this.transactionFailure.error;
      }
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.transactionDepth -= 1;
      this.transactionFailure = undefined;
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
    this.lease?.close();
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

/** Resolve symlink aliases before deriving the lease name, including a not-yet-created database. */
function canonicalPath(location: string, links = 0): string {
  try {
    return realpathSync.native(location);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    const file = path.join(realpathSync.native(path.dirname(location)), path.basename(location));
    // realpath cannot resolve a dangling leaf. SQLite would follow it when creating the file,
    // so the lease and main connection must both use that eventual target, never the alias.
    if (lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) {
      if (links >= 40)
        throw new Error("too many database symlinks; use a direct state database path");
      const target = readlinkSync(file);
      // Keep '..' until the filesystem resolves it: a preceding directory may itself be a link.
      return canonicalPath(
        path.isAbsolute(target) ? target : `${path.dirname(file)}/${target}`,
        links + 1,
      );
    }
    return file;
  }
}

/**
 * Hold an exclusive SQLite lock on a separate, credential-free file for the connection lifetime.
 * OS locks disappear on crash; never unlink a lease file (that could create two lock inodes).
 * The main WAL database remains readable, and no heartbeat or stale-PID takeover race is needed.
 */
function acquireLease(file: string): DatabaseSync {
  const lockPath = `${file}.runner-lock`;
  try {
    closeSync(openSync(lockPath, "wx", 0o600));
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
  }
  const lease = new DatabaseSync(lockPath);
  try {
    lease.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;");
    return lease;
  } catch (error) {
    lease.close();
    if (
      error instanceof Error &&
      "errcode" in error &&
      (error.errcode === 5 || error.errcode === 6)
    )
      throw new InstanceLockError();
    throw error;
  }
}
