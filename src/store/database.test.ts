import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { SchemaVersionError, WorkflowDatabase } from "./database.js";
import { LATEST_SCHEMA_VERSION } from "./migrations.js";

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
});
