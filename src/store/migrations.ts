/**
 * Ordered schema migrations. The applied version lives in SQLite's `user_version`, so a database
 * records how far it has been migrated without a separate bookkeeping table.
 *
 * Invariants enforced by the database itself, not only by application code:
 * - at most one active attempt across the whole database (partial unique index);
 * - at most one accepted report and at most one transition per attempt;
 * - every row refers to an existing run, task, attempt, or revision (foreign keys).
 *
 * Migrations are append-only. Never edit one that has shipped; add a new version instead.
 */
export interface Migration {
  readonly version: number;
  readonly sql: string;
}

const ACTIVE_LIST = "'created', 'starting', 'running', 'settling'";

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE workflow_revisions (
  revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_sha256 TEXT NOT NULL,
  definition_yaml TEXT NOT NULL,
  source_dir TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (definition_sha256, source_dir)
);

CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  revision_id INTEGER NOT NULL REFERENCES workflow_revisions (revision_id),
  project_root TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'ready', 'running', 'pausing', 'paused', 'completed', 'stopped', 'interrupted')),
  cursor_step_id TEXT NOT NULL,
  active_task_id TEXT REFERENCES tasks (task_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT
);

CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs (run_id),
  source_order INTEGER NOT NULL,
  source_identity TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  heading_path TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL CHECK (state IN ('pending', 'active', 'completed')),
  UNIQUE (run_id, source_order)
);

CREATE TABLE attempts (
  attempt_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs (run_id),
  step_id TEXT NOT NULL,
  task_id TEXT REFERENCES tasks (task_id),
  revision_id INTEGER NOT NULL REFERENCES workflow_revisions (revision_id),
  sequence_no INTEGER NOT NULL,
  session_id TEXT,
  pid INTEGER,
  pgid INTEGER,
  process_identity TEXT,
  status TEXT NOT NULL CHECK (status IN ('created', 'starting', 'running', 'settling', 'succeeded', 'failed', 'interrupted')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  exit_code INTEGER,
  error_code TEXT,
  UNIQUE (run_id, sequence_no)
);

-- Every active row produces the same index key (true), so a second active row violates the index.
-- This makes "one active attempt globally" a database guarantee.
CREATE UNIQUE INDEX attempts_single_active ON attempts ((status IN (${ACTIVE_LIST})))
  WHERE status IN (${ACTIVE_LIST});

CREATE TABLE reports (
  report_id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts (attempt_id),
  outcome TEXT NOT NULL,
  summary TEXT NOT NULL,
  issue TEXT,
  handoff TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  received_at TEXT NOT NULL
);

-- Engine-only steps (task.next, task.complete) have no attempt, so attempt_id may be NULL. Non-NULL
-- values are unique: one committed transition per finalized attempt.
CREATE TABLE transitions (
  transition_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs (run_id),
  revision_id INTEGER NOT NULL REFERENCES workflow_revisions (revision_id),
  attempt_id TEXT UNIQUE REFERENCES attempts (attempt_id),
  from_step_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  action_json TEXT NOT NULL,
  to_step_id TEXT,
  committed_at TEXT NOT NULL
);

CREATE TABLE events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs (run_id),
  attempt_id TEXT REFERENCES attempts (attempt_id),
  revision_id INTEGER REFERENCES workflow_revisions (revision_id),
  type TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  timestamp TEXT NOT NULL
);

CREATE INDEX events_by_run ON events (run_id, event_id);

CREATE TABLE attention_items (
  item_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs (run_id),
  attempt_id TEXT REFERENCES attempts (attempt_id),
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'blocking')),
  message TEXT NOT NULL,
  resolution TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    sql: `
ALTER TABLE attempts ADD COLUMN stdout_text TEXT;
ALTER TABLE attempts ADD COLUMN log_path TEXT;
`,
  },
  {
    version: 3,
    sql: `ALTER TABLE attempts ADD COLUMN correction_count INTEGER NOT NULL DEFAULT 0 CHECK (correction_count IN (0, 1));`,
  },
  {
    version: 4,
    sql: `
ALTER TABLE tasks ADD COLUMN source_line INTEGER;
ALTER TABLE tasks ADD COLUMN source_column INTEGER;
ALTER TABLE tasks ADD COLUMN source_checked INTEGER CHECK (source_checked IN (0, 1));
ALTER TABLE tasks ADD COLUMN source_indent INTEGER;
CREATE TABLE task_imports (
  run_id TEXT PRIMARY KEY REFERENCES runs(run_id),
  source_path TEXT NOT NULL,
  source_markdown TEXT NOT NULL,
  include_completed INTEGER NOT NULL CHECK (include_completed IN (0, 1)),
  source_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`,
  },
  {
    version: 5,
    sql: `CREATE TABLE attempt_inputs (
  attempt_id TEXT PRIMARY KEY REFERENCES attempts(attempt_id),
  input_json TEXT NOT NULL
);`,
  },
  {
    version: 6,
    sql: `CREATE TABLE task_overrides (
  task_id TEXT PRIMARY KEY REFERENCES tasks(task_id),
  overrides_json TEXT NOT NULL
);
ALTER TABLE attempts ADD COLUMN task_overrides_json TEXT NOT NULL DEFAULT '{"steps":{}}';`,
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
