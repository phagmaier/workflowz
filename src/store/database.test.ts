import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, describe, it } from "node:test";
import { childEnvironment } from "../adapters/environment.js";
import { InstanceLockError, SchemaVersionError, WorkflowDatabase } from "./database.js";
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from "./migrations.js";
import { RunStore } from "./run-store.js";

const temporaryDirectories: string[] = [];

function tempFile(name: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "wf-store-"));
  temporaryDirectories.push(directory);
  return path.join(directory, name);
}

after(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** Inserts the minimum parent rows an attempt needs, returning the revision id. */
function seedRun(db: WorkflowDatabase, runId: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO workflow_revisions (revision_id, definition_sha256, definition_yaml, source_dir, created_at) VALUES (1, 'h', 'y', '/d', 't')",
  ).run();
  db.prepare(
    "INSERT INTO runs (run_id, revision_id, project_root, status, cursor_step_id, created_at, updated_at) VALUES (?, 1, '/p', 'running', 's', 't', 't')",
  ).run(runId);
}

function insertAttempt(
  db: WorkflowDatabase,
  attemptId: string,
  runId: string,
  status: string,
  sequence: number,
): void {
  db.prepare(
    "INSERT INTO attempts (attempt_id, run_id, step_id, revision_id, sequence_no, status, started_at) VALUES (?, ?, 's', 1, ?, ?, 't')",
  ).run(attemptId, runId, sequence, status);
}

describe("WorkflowDatabase", () => {
  it("upgrades schema 8 with no invented retry wait or changed execution history", () => {
    const file = tempFile("schema8.sqlite");
    const old = new DatabaseSync(file);
    for (const migration of MIGRATIONS.filter((m) => m.version <= 8)) old.exec(migration.sql);
    old.exec(`PRAGMA user_version = 8;
      INSERT INTO workflow_revisions VALUES (1, 'hash', 'definition', '/root', 'time');
      INSERT INTO runs (run_id, revision_id, project_root, status, cursor_step_id, created_at, updated_at) VALUES ('r', 1, '/root', 'paused', 'work', 'time', 'time');
      INSERT INTO attempts (attempt_id, run_id, step_id, revision_id, sequence_no, status, started_at, correction_count) VALUES ('a', 'r', 'work', 1, 1, 'failed', 'time', 1);
      INSERT INTO transitions (run_id, revision_id, attempt_id, from_step_id, outcome, action_json, to_step_id, committed_at) VALUES ('r', 1, 'a', 'work', 'failed', '{"kind":"retry","maxAttempts":2,"backoffSeconds":10}', 'work', 'time');`);
    const attempts = old.prepare("SELECT * FROM attempts").all();
    const transitions = old.prepare("SELECT * FROM transitions").all();
    old.close();
    const database = new WorkflowDatabase(file);
    try {
      const store = new RunStore(database, () => "now");
      assert.equal(store.getRun("r").retryNotBefore, null);
      assert.equal(store.countAttempts("r", "work", null), 1);
      assert.equal(store.countTransitions("r"), 1);
      assert.deepEqual(database.prepare("SELECT * FROM attempts").all(), attempts);
      assert.deepEqual(database.prepare("SELECT * FROM transitions").all(), transitions);
    } finally {
      database.close();
    }
  });
  it("upgrades schema 5 without changing historical attempts, reports or input snapshots", () => {
    const file = tempFile("schema5.sqlite");
    const old = new DatabaseSync(file);
    for (const migration of MIGRATIONS.filter((migration) => migration.version <= 5))
      old.exec(migration.sql);
    old.exec(`PRAGMA user_version = 5;
      INSERT INTO workflow_revisions VALUES (1, 'hash', 'definition', '/root', 'time');
      INSERT INTO runs (run_id, revision_id, project_root, status, cursor_step_id, created_at, updated_at) VALUES ('run_old', 1, '/root', 'paused', 'work', 'time', 'time');
      INSERT INTO attempts (attempt_id, run_id, step_id, revision_id, sequence_no, status, started_at, session_id) VALUES ('attempt_old', 'run_old', 'work', 1, 1, 'succeeded', 'time', 'old-session');
      INSERT INTO reports (attempt_id, outcome, summary, received_at) VALUES ('attempt_old', 'complete', 'historical', 'time');
      INSERT INTO attempt_inputs VALUES ('attempt_old', '{"prompt":"old input"}');`);
    const before = old.prepare("SELECT * FROM reports").all();
    old.close();
    const db = new WorkflowDatabase(file);
    try {
      assert.equal(db.schemaVersion(), LATEST_SCHEMA_VERSION);
      assert.deepEqual(db.prepare("SELECT * FROM reports").all(), before);
      const store = new RunStore(db, () => "time");
      assert.deepEqual(store.getAttempt("attempt_old")?.taskOverrides, { steps: {} });
      assert.equal(store.getAttempt("attempt_old")?.sessionId, "old-session");
      assert.deepEqual(store.attemptInput("attempt_old"), { prompt: "old input" });
      assert.equal(store.getRun("run_old").revisionId, 1);
    } finally {
      db.close();
    }
  });

  it("migrates a new database to the latest schema version", () => {
    const db = new WorkflowDatabase(":memory:");
    assert.equal(db.schemaVersion(), LATEST_SCHEMA_VERSION);
    db.close();
  });

  it("keeps data and does not re-run migrations when a file database is reopened", () => {
    const file = tempFile("reopen.sqlite");
    const first = new WorkflowDatabase(file);
    seedRun(first, "run_a");
    first.close();

    const second = new WorkflowDatabase(file);
    assert.equal(second.schemaVersion(), LATEST_SCHEMA_VERSION);
    assert.deepEqual(
      second
        .prepare("SELECT run_id FROM runs")
        .all()
        .map((row) => row["run_id"]),
      ["run_a"],
    );
    second.close();
  });

  it("refuses to open a database written by a newer build", () => {
    const file = tempFile("newer.sqlite");
    const db = new WorkflowDatabase(file);
    db.prepare(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 1}`).run();
    db.close();
    assert.throws(() => new WorkflowDatabase(file), SchemaVersionError);
  });

  it("allows at most one active attempt across the whole database", () => {
    const db = new WorkflowDatabase(":memory:");
    seedRun(db, "run_a");
    seedRun(db, "run_b");
    insertAttempt(db, "a1", "run_a", "starting", 1);
    insertAttempt(db, "a2", "run_a", "succeeded", 2);
    insertAttempt(db, "b1", "run_b", "succeeded", 1);
    assert.throws(() => insertAttempt(db, "a3", "run_a", "running", 3), /UNIQUE constraint failed/);
    assert.throws(
      () => insertAttempt(db, "b2", "run_b", "settling", 2),
      /UNIQUE constraint failed/,
    );
    db.close();
  });

  it("records at most one transition per attempt", () => {
    const db = new WorkflowDatabase(":memory:");
    seedRun(db, "run_a");
    insertAttempt(db, "a1", "run_a", "succeeded", 1);
    const insert = db.prepare(
      "INSERT INTO transitions (run_id, revision_id, attempt_id, from_step_id, outcome, action_json, to_step_id, committed_at) VALUES ('run_a', 1, 'a1', 's', 'complete', '{}', 'next', 't')",
    );
    insert.run();
    assert.throws(() => insert.run(), /UNIQUE constraint failed/);
    db.close();
  });

  it("enforces foreign keys", () => {
    const db = new WorkflowDatabase(":memory:");
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO tasks (task_id, run_id, source_order, source_identity, title, state) VALUES ('t', 'missing', 0, 'i', 'x', 'pending')",
          )
          .run(),
      /FOREIGN KEY constraint failed/,
    );
    db.close();
  });

  it("commits a transaction only if its work completes", () => {
    const db = new WorkflowDatabase(":memory:");
    db.transaction(() => seedRun(db, "kept"));
    assert.throws(() =>
      db.transaction(() => {
        seedRun(db, "discarded");
        throw new Error("boom");
      }),
    );
    assert.deepEqual(
      db
        .prepare("SELECT run_id FROM runs ORDER BY run_id")
        .all()
        .map((row) => row["run_id"]),
      ["kept"],
    );
    db.close();
  });

  it("joins a nested transaction to the outer one, so an inner failure rolls back everything", () => {
    const db = new WorkflowDatabase(":memory:");
    assert.throws(() =>
      db.transaction(() => {
        db.transaction(() => seedRun(db, "inner"));
        throw new Error("outer failure after inner success");
      }),
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM runs").get()?.["n"], 0);
    db.close();
  });

  it("rolls back the whole transaction even when an inner failure is caught", () => {
    const db = new WorkflowDatabase(":memory:");
    const failure = new Error("inner failure");
    assert.throws(
      () =>
        db.transaction(() => {
          seedRun(db, "outer");
          assert.throws(
            () =>
              db.transaction(() => {
                seedRun(db, "inner");
                throw failure;
              }),
            (error) => error === failure,
          );
          seedRun(db, "after_catch");
        }),
      (error) => error === failure,
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM runs").get()?.["n"], 0);
    db.transaction(() => seedRun(db, "next_transaction"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM runs").get()?.["n"], 1);
    db.close();
  });

  it("rejects a competing writer and symlink alias while allowing read-only committed inspection", () => {
    const file = tempFile("owner.sqlite");
    const owner = new WorkflowDatabase(file);
    try {
      seedRun(owner, "owned");
      const alias = path.join(path.dirname(file), "alias.sqlite");
      symlinkSync(file, alias);
      assert.throws(() => new WorkflowDatabase(file), InstanceLockError);
      assert.throws(() => new WorkflowDatabase(alias), InstanceLockError);
      const observer = new WorkflowDatabase(alias, { readOnly: true });
      try {
        assert.equal(observer.prepare("SELECT run_id FROM runs").get()?.["run_id"], "owned");
        assert.throws(() => seedRun(observer, "forbidden"));
        assert.throws(() => observer.transaction(() => seedRun(observer, "forbidden")));
        assert.equal(owner.prepare("SELECT COUNT(*) AS n FROM runs").get()?.["n"], 1);
      } finally {
        observer.close();
      }
      const peer = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
        import { WorkflowDatabase, InstanceLockError } from ${JSON.stringify(new URL("./database.js", import.meta.url).href)};
        try { const db = new WorkflowDatabase(process.argv[1]); db.close(); process.exit(2); }
        catch (error) { if (!(error instanceof InstanceLockError)) throw error; }
      `,
          file,
        ],
        { env: childEnvironment(), timeout: 5000 },
      );
      assert.equal(
        peer.status,
        0,
        "failed local contenders and observers must not release the owner's OS lock",
      );
    } finally {
      owner.close();
    }
    const next = new WorkflowDatabase(file);
    try {
      seedRun(next, "next_owner");
      assert.equal(next.prepare("SELECT COUNT(*) AS n FROM runs").get()?.["n"], 2);
    } finally {
      next.close();
    }
  });

  it("releases ownership if opening an unsupported schema fails", () => {
    const file = tempFile("failed-open.sqlite");
    const raw = new DatabaseSync(file);
    raw.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 1}`);
    raw.close();
    assert.throws(() => new WorkflowDatabase(file), SchemaVersionError);
    const repair = new DatabaseSync(file);
    repair.exec("PRAGMA user_version = 0");
    repair.close();
    const owner = new WorkflowDatabase(file);
    try {
      seedRun(owner, "after_failure");
      assert.equal(owner.prepare("SELECT run_id FROM runs").get()?.["run_id"], "after_failure");
    } finally {
      owner.close();
    }
  });

  it("migrates schema 6 interrupted attempts conservatively without rewriting historical identity", () => {
    const file = tempFile("schema6.sqlite");
    const old = new DatabaseSync(file);
    for (const migration of MIGRATIONS.filter((m) => m.version <= 6)) old.exec(migration.sql);
    old.exec(`PRAGMA user_version = 6;
      INSERT INTO workflow_revisions VALUES (1, 'h', 'y', '/d', 't');
      INSERT INTO runs (run_id, revision_id, project_root, status, cursor_step_id, created_at, updated_at) VALUES ('r', 1, '/p', 'interrupted', 's', 't', 't');
      INSERT INTO attempts (attempt_id, run_id, step_id, revision_id, sequence_no, status, started_at, error_code, process_identity)
      VALUES ('a', 'r', 's', 1, 1, 'interrupted', 't', 'uncertain_after_restart', 'legacy-identity');`);
    old.close();
    const owner = new WorkflowDatabase(file);
    try {
      const store = new RunStore(owner, () => "now");
      assert.equal(store.pendingRecovery()?.attemptId, "a");
      assert.equal(store.getAttempt("a")?.processIdentity, null);
      assert.equal(
        owner.prepare("SELECT process_identity FROM attempts").get()?.["process_identity"],
        "legacy-identity",
      );
      assert.equal(store.getAttempt("a")?.recoveryState, "unknown");
    } finally {
      owner.close();
    }
  });
});
