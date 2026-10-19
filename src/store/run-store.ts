/**
 * Repository for runs, tasks, attempts, transitions, events, and attention items.
 *
 * The store does reads and writes only. It makes no routing decisions, so the coordinator is the
 * one place that decides what a state change means. Each method runs in its caller's transaction,
 * or in its own when called alone.
 */
import type {
  AttemptStatus,
  AttentionSeverity,
  EventType,
  RunStatus,
  TaskState,
} from "../contracts/run-state.js";
import type { WorkflowDatabase } from "./database.js";

export interface RevisionRow {
  readonly revisionId: number;
  readonly definitionSha256: string;
  readonly definitionYaml: string;
  readonly sourceDir: string;
}

export interface RunRow {
  readonly runId: string;
  readonly revisionId: number;
  readonly projectRoot: string;
  readonly status: RunStatus;
  readonly cursorStepId: string;
  readonly activeTaskId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startTime: string | null;
  readonly endTime: string | null;
}

export interface TaskRow {
  readonly taskId: string;
  readonly runId: string;
  readonly sourceOrder: number;
  readonly sourceIdentity: string;
  readonly title: string;
  readonly body: string;
  readonly headingPath: readonly string[];
  readonly state: TaskState;
}

export interface AttemptRow {
  readonly attemptId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly taskId: string | null;
  readonly revisionId: number;
  readonly sequenceNo: number;
  readonly status: AttemptStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly exitCode: number | null;
  readonly errorCode: string | null;
}

export interface TransitionRow {
  readonly transitionId: number;
  readonly runId: string;
  readonly revisionId: number;
  readonly attemptId: string | null;
  readonly fromStepId: string;
  readonly outcome: string;
  readonly actionJson: string;
  readonly toStepId: string | null;
  readonly committedAt: string;
}

export interface EventRow {
  readonly eventId: number;
  readonly runId: string;
  readonly attemptId: string | null;
  readonly type: EventType;
  readonly data: Record<string, unknown>;
  readonly timestamp: string;
}

export interface AttentionRow {
  readonly itemId: number;
  readonly runId: string;
  readonly attemptId: string | null;
  readonly category: string;
  readonly severity: AttentionSeverity;
  readonly message: string;
  readonly createdAt: string;
}

export interface NewTask {
  readonly sourceOrder: number;
  readonly sourceIdentity: string;
  readonly title: string;
  readonly body?: string;
  readonly headingPath?: readonly string[];
}

/** Raw rows as node:sqlite returns them. Converted to the camelCase shapes above. */
type Raw = Record<string, unknown>;

export class RunStore {
  constructor(
    private readonly database: WorkflowDatabase,
    private readonly clock: () => string,
  ) {}

  saveRevision(definitionYaml: string, definitionSha256: string, sourceDir: string): number {
    return this.database.transaction(() => {
      this.database
        .prepare(
          "INSERT OR IGNORE INTO workflow_revisions (definition_sha256, definition_yaml, source_dir, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(definitionSha256, definitionYaml, sourceDir, this.clock());
      const row = this.database
        .prepare(
          "SELECT revision_id FROM workflow_revisions WHERE definition_sha256 = ? AND source_dir = ?",
        )
        .get(definitionSha256, sourceDir) as { revision_id: number } | undefined;
      if (!row) {
        throw new Error("revision was not stored");
      }
      return row.revision_id;
    });
  }

  getRevision(revisionId: number): RevisionRow {
    const row = this.database
      .prepare("SELECT * FROM workflow_revisions WHERE revision_id = ?")
      .get(revisionId) as Raw | undefined;
    if (!row) {
      throw new Error(`no workflow revision ${revisionId}`);
    }
    return {
      revisionId: row["revision_id"] as number,
      definitionSha256: row["definition_sha256"] as string,
      definitionYaml: row["definition_yaml"] as string,
      sourceDir: row["source_dir"] as string,
    };
  }

  /** Inserts a run, its snapshot of tasks, and `run_created`, all in one transaction. */
  createRun(input: {
    runId: string;
    revisionId: number;
    projectRoot: string;
    startStepId: string;
    tasks: readonly NewTask[];
  }): void {
    this.database.transaction(() => {
      const now = this.clock();
      this.database
        .prepare(
          "INSERT INTO runs (run_id, revision_id, project_root, status, cursor_step_id, active_task_id, created_at, updated_at) VALUES (?, ?, ?, 'ready', ?, NULL, ?, ?)",
        )
        .run(input.runId, input.revisionId, input.projectRoot, input.startStepId, now, now);
      input.tasks.forEach((task) => {
        this.database
          .prepare(
            "INSERT INTO tasks (task_id, run_id, source_order, source_identity, title, body, heading_path, state) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')",
          )
          .run(
            taskIdFor(input.runId, task.sourceOrder),
            input.runId,
            task.sourceOrder,
            task.sourceIdentity,
            task.title,
            task.body ?? "",
            JSON.stringify(task.headingPath ?? []),
          );
      });
      this.appendEvent({
        runId: input.runId,
        revisionId: input.revisionId,
        type: "run_created",
        data: { tasks: input.tasks.length },
      });
    });
  }

  getRun(runId: string): RunRow {
    const row = this.database.prepare("SELECT * FROM runs WHERE run_id = ?").get(runId) as
      | Raw
      | undefined;
    if (!row) {
      throw new Error(`no run ${runId}`);
    }
    return {
      runId: row["run_id"] as string,
      revisionId: row["revision_id"] as number,
      projectRoot: row["project_root"] as string,
      status: row["status"] as RunStatus,
      cursorStepId: row["cursor_step_id"] as string,
      activeTaskId: (row["active_task_id"] as string | null) ?? null,
      createdAt: row["created_at"] as string,
      updatedAt: row["updated_at"] as string,
      startTime: (row["start_time"] as string | null) ?? null,
      endTime: (row["end_time"] as string | null) ?? null,
    };
  }

  /** Writes the run's mutable fields. Unspecified fields keep their current value. */
  updateRun(
    runId: string,
    patch: Partial<
      Pick<RunRow, "status" | "cursorStepId" | "activeTaskId" | "startTime" | "endTime">
    >,
  ): void {
    const current = this.getRun(runId);
    const next = { ...current, ...patch };
    this.database
      .prepare(
        "UPDATE runs SET status = ?, cursor_step_id = ?, active_task_id = ?, start_time = ?, end_time = ?, updated_at = ? WHERE run_id = ?",
      )
      .run(
        next.status,
        next.cursorStepId,
        next.activeTaskId,
        next.startTime,
        next.endTime,
        this.clock(),
        runId,
      );
  }

  listTasks(runId: string): TaskRow[] {
    const rows = this.database
      .prepare("SELECT * FROM tasks WHERE run_id = ? ORDER BY source_order")
      .all(runId) as Raw[];
    return rows.map((row) => ({
      taskId: row["task_id"] as string,
      runId: row["run_id"] as string,
      sourceOrder: row["source_order"] as number,
      sourceIdentity: row["source_identity"] as string,
      title: row["title"] as string,
      body: row["body"] as string,
      headingPath: JSON.parse(row["heading_path"] as string) as string[],
      state: row["state"] as TaskState,
    }));
  }

  setTaskState(taskId: string, state: TaskState): void {
    this.database.prepare("UPDATE tasks SET state = ? WHERE task_id = ?").run(state, taskId);
  }

  getAttempt(attemptId: string): AttemptRow | undefined {
    const row = this.database
      .prepare("SELECT * FROM attempts WHERE attempt_id = ?")
      .get(attemptId) as Raw | undefined;
    return row ? toAttempt(row) : undefined;
  }

  activeAttempt(runId: string): AttemptRow | undefined {
    const row = this.database
      .prepare(
        "SELECT * FROM attempts WHERE run_id = ? AND status IN ('created', 'starting', 'running', 'settling') LIMIT 1",
      )
      .get(runId) as Raw | undefined;
    return row ? toAttempt(row) : undefined;
  }

  /** Attempts of one step within one task (or without a task), including settled ones. */
  countAttempts(runId: string, stepId: string, taskId: string | null): number {
    const row = this.database
      .prepare(
        "SELECT COUNT(*) AS n FROM attempts WHERE run_id = ? AND step_id = ? AND task_id IS ?",
      )
      .get(runId, stepId, taskId) as { n: number };
    return row.n;
  }

  insertAttempt(input: {
    attemptId: string;
    runId: string;
    stepId: string;
    taskId: string | null;
    revisionId: number;
  }): AttemptRow {
    return this.database.transaction(() => {
      const next = this.database
        .prepare("SELECT COALESCE(MAX(sequence_no), 0) + 1 AS n FROM attempts WHERE run_id = ?")
        .get(input.runId) as { n: number };
      const startedAt = this.clock();
      this.database
        .prepare(
          "INSERT INTO attempts (attempt_id, run_id, step_id, task_id, revision_id, sequence_no, status, started_at) VALUES (?, ?, ?, ?, ?, ?, 'starting', ?)",
        )
        .run(
          input.attemptId,
          input.runId,
          input.stepId,
          input.taskId,
          input.revisionId,
          next.n,
          startedAt,
        );
      return this.getAttempt(input.attemptId) as AttemptRow;
    });
  }

  setAttemptStatus(
    attemptId: string,
    status: AttemptStatus,
    finish?: { exitCode?: number | null; errorCode?: string | null },
  ): void {
    const finished = finish !== undefined || status === "succeeded" || status === "failed";
    this.database
      .prepare(
        "UPDATE attempts SET status = ?, finished_at = COALESCE(?, finished_at), exit_code = COALESCE(?, exit_code), error_code = COALESCE(?, error_code) WHERE attempt_id = ?",
      )
      .run(
        status,
        finished ? this.clock() : null,
        finish?.exitCode ?? null,
        finish?.errorCode ?? null,
        attemptId,
      );
  }

  insertTransition(input: {
    runId: string;
    revisionId: number;
    attemptId: string | null;
    fromStepId: string;
    outcome: string;
    actionJson: string;
    toStepId: string | null;
  }): void {
    this.database
      .prepare(
        "INSERT INTO transitions (run_id, revision_id, attempt_id, from_step_id, outcome, action_json, to_step_id, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        input.runId,
        input.revisionId,
        input.attemptId,
        input.fromStepId,
        input.outcome,
        input.actionJson,
        input.toStepId,
        this.clock(),
      );
  }

  countTransitions(runId: string): number {
    const row = this.database
      .prepare("SELECT COUNT(*) AS n FROM transitions WHERE run_id = ?")
      .get(runId) as {
      n: number;
    };
    return row.n;
  }

  listTransitions(runId: string): TransitionRow[] {
    const rows = this.database
      .prepare("SELECT * FROM transitions WHERE run_id = ? ORDER BY transition_id")
      .all(runId) as Raw[];
    return rows.map((row) => ({
      transitionId: row["transition_id"] as number,
      runId: row["run_id"] as string,
      revisionId: row["revision_id"] as number,
      attemptId: (row["attempt_id"] as string | null) ?? null,
      fromStepId: row["from_step_id"] as string,
      outcome: row["outcome"] as string,
      actionJson: row["action_json"] as string,
      toStepId: (row["to_step_id"] as string | null) ?? null,
      committedAt: row["committed_at"] as string,
    }));
  }

  appendEvent(input: {
    runId: string;
    attemptId?: string | null;
    revisionId?: number | null;
    type: EventType;
    data?: Record<string, unknown>;
  }): void {
    this.database
      .prepare(
        "INSERT INTO events (run_id, attempt_id, revision_id, type, data_json, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        input.runId,
        input.attemptId ?? null,
        input.revisionId ?? null,
        input.type,
        JSON.stringify(input.data ?? {}),
        this.clock(),
      );
  }

  listEvents(runId: string): EventRow[] {
    const rows = this.database
      .prepare("SELECT * FROM events WHERE run_id = ? ORDER BY event_id")
      .all(runId) as Raw[];
    return rows.map((row) => ({
      eventId: row["event_id"] as number,
      runId: row["run_id"] as string,
      attemptId: (row["attempt_id"] as string | null) ?? null,
      type: row["type"] as EventType,
      data: JSON.parse(row["data_json"] as string) as Record<string, unknown>,
      timestamp: row["timestamp"] as string,
    }));
  }

  insertAttention(input: {
    runId: string;
    attemptId?: string | null;
    category: string;
    severity: AttentionSeverity;
    message: string;
  }): void {
    this.database
      .prepare(
        "INSERT INTO attention_items (run_id, attempt_id, category, severity, message, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        input.runId,
        input.attemptId ?? null,
        input.category,
        input.severity,
        input.message,
        this.clock(),
      );
  }

  listAttention(runId: string): AttentionRow[] {
    const rows = this.database
      .prepare("SELECT * FROM attention_items WHERE run_id = ? ORDER BY item_id")
      .all(runId) as Raw[];
    return rows.map((row) => ({
      itemId: row["item_id"] as number,
      runId: row["run_id"] as string,
      attemptId: (row["attempt_id"] as string | null) ?? null,
      category: row["category"] as string,
      severity: row["severity"] as AttentionSeverity,
      message: row["message"] as string,
      createdAt: row["created_at"] as string,
    }));
  }
}

/** Task IDs are unique across runs because they include the run ID and the source position. */
export function taskIdFor(runId: string, sourceOrder: number): string {
  return `${runId}.t${sourceOrder}`;
}

function toAttempt(row: Raw): AttemptRow {
  return {
    attemptId: row["attempt_id"] as string,
    runId: row["run_id"] as string,
    stepId: row["step_id"] as string,
    taskId: (row["task_id"] as string | null) ?? null,
    revisionId: row["revision_id"] as number,
    sequenceNo: row["sequence_no"] as number,
    status: row["status"] as AttemptStatus,
    startedAt: row["started_at"] as string,
    finishedAt: (row["finished_at"] as string | null) ?? null,
    exitCode: (row["exit_code"] as number | null) ?? null,
    errorCode: (row["error_code"] as string | null) ?? null,
  };
}
