/**
 * Repository for runs, tasks, attempts, transitions, events, and attention items.
 *
 * The store does reads and writes only. It makes no routing decisions, so the coordinator is the
 * one place that decides what a state change means. Each method runs in its caller's transaction,
 * or in its own when called alone.
 */

import type { AgentInputSnapshot } from "../contracts/agent-context.js";
import type { AgentReport } from "../contracts/report.js";
import type { TaskOverrides } from "../contracts/run-configuration.js";
import type {
  AttemptStatus,
  AttentionSeverity,
  EventType,
  RunStatus,
  TaskState,
} from "../contracts/run-state.js";
import type { TaskImportSnapshot } from "../contracts/task-import.js";
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
  readonly sourceLine: number | null;
  readonly sourceColumn: number | null;
  readonly sourceChecked: boolean | null;
  readonly sourceIndent: number | null;
}

export interface AttemptRow {
  readonly taskOverrides: TaskOverrides;
  readonly attemptId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly taskId: string | null;
  readonly revisionId: number;
  readonly sequenceNo: number;
  readonly sessionId: string | null;
  readonly correctionCount: number;
  readonly status: AttemptStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly exitCode: number | null;
  readonly errorCode: string | null;
}

export interface ReportRow extends AgentReport {
  readonly reportId: number;
  readonly attemptId: string;
  readonly receivedAt: string;
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
  readonly revisionId: number | null;
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
  readonly sourceLine?: number;
  readonly sourceColumn?: number;
  readonly sourceChecked?: boolean;
  readonly sourceIndent?: number;
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
            "INSERT INTO tasks (task_id, run_id, source_order, source_identity, title, body, heading_path, source_line, source_column, source_checked, source_indent, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
          )
          .run(
            taskIdFor(input.runId, task.sourceOrder),
            input.runId,
            task.sourceOrder,
            task.sourceIdentity,
            task.title,
            task.body ?? "",
            JSON.stringify(task.headingPath ?? []),
            task.sourceLine ?? null,
            task.sourceColumn ?? null,
            task.sourceChecked === undefined ? null : Number(task.sourceChecked),
            task.sourceIndent ?? null,
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

  /** The globally running or pausing run, if any. Call within the caller's write transaction. */
  activeRunId(): string | undefined {
    const row = this.database
      .prepare("SELECT run_id FROM runs WHERE status IN ('running', 'pausing') LIMIT 1")
      .get() as { run_id: string } | undefined;
    return row?.run_id;
  }

  /** Writes the run's mutable fields. Unspecified fields keep their current value. */
  updateRun(
    runId: string,
    patch: Partial<
      Pick<
        RunRow,
        "status" | "cursorStepId" | "activeTaskId" | "startTime" | "endTime" | "revisionId"
      >
    >,
  ): void {
    const current = this.getRun(runId);
    const next = { ...current, ...patch };
    this.database
      .prepare(
        "UPDATE runs SET status = ?, cursor_step_id = ?, active_task_id = ?, start_time = ?, end_time = ?, revision_id = ?, updated_at = ? WHERE run_id = ?",
      )
      .run(
        next.status,
        next.cursorStepId,
        next.activeTaskId,
        next.startTime,
        next.endTime,
        next.revisionId,
        this.clock(),
        runId,
      );
  }

  listAttempts(runId: string): AttemptRow[] {
    const rows = this.database
      .prepare("SELECT * FROM attempts WHERE run_id = ? ORDER BY sequence_no")
      .all(runId) as Raw[];
    return rows.map(toAttempt);
  }

  getReport(attemptId: string): ReportRow | undefined {
    const row = this.database
      .prepare("SELECT * FROM reports WHERE attempt_id = ?")
      .get(attemptId) as Raw | undefined;
    return row
      ? {
          reportId: row["report_id"] as number,
          attemptId,
          outcome: row["outcome"] as string,
          summary: row["summary"] as string,
          issue: row["issue"] as string | null,
          ...(row["handoff"] === null ? {} : { handoff: row["handoff"] as string }),
          data: JSON.parse(row["data_json"] as string) as Record<string, unknown>,
          receivedAt: row["received_at"] as string,
        }
      : undefined;
  }

  latestReport(runId: string, stepId: string, taskId: string | null): ReportRow | undefined {
    const row = this.database
      .prepare(
        "SELECT r.attempt_id FROM reports r JOIN attempts a ON a.attempt_id = r.attempt_id WHERE a.run_id = ? AND a.step_id = ? AND a.task_id IS ? ORDER BY a.sequence_no DESC LIMIT 1",
      )
      .get(runId, stepId, taskId) as { attempt_id: string } | undefined;
    return row ? this.getReport(row.attempt_id) : undefined;
  }

  saveAttemptInput(attemptId: string, input: AgentInputSnapshot): void {
    this.database
      .prepare("INSERT INTO attempt_inputs (attempt_id, input_json) VALUES (?, ?)")
      .run(attemptId, JSON.stringify(input));
  }

  attemptInput(attemptId: string): AgentInputSnapshot | undefined {
    const row = this.database
      .prepare("SELECT input_json FROM attempt_inputs WHERE attempt_id = ?")
      .get(attemptId) as { input_json: string } | undefined;
    return row ? (JSON.parse(row.input_json) as AgentInputSnapshot) : undefined;
  }

  insertReport(attemptId: string, report: AgentReport): ReportRow {
    this.database
      .prepare(
        "INSERT INTO reports (attempt_id, outcome, summary, issue, handoff, data_json, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        attemptId,
        report.outcome,
        report.summary,
        report.issue ?? null,
        report.handoff ?? null,
        JSON.stringify(report.data ?? {}),
        this.clock(),
      );
    return this.getReport(attemptId) as ReportRow;
  }

  setProcess(attemptId: string, pid: number | null, sessionId: string | null): void {
    this.database
      .prepare(
        "UPDATE attempts SET pid = ?, pgid = ?, session_id = COALESCE(?, session_id), status = 'running' WHERE attempt_id = ?",
      )
      .run(pid, pid, sessionId, attemptId);
  }

  reserveCorrection(attemptId: string): void {
    this.database
      .prepare("UPDATE attempts SET correction_count = 1 WHERE attempt_id = ?")
      .run(attemptId);
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
      sourceLine: row["source_line"] as number | null,
      sourceColumn: row["source_column"] as number | null,
      sourceChecked: row["source_checked"] === null ? null : row["source_checked"] === 1,
      sourceIndent: row["source_indent"] as number | null,
    }));
  }

  saveTaskImport(runId: string, snapshot: TaskImportSnapshot, sha256: string): void {
    this.database
      .prepare(
        "INSERT INTO task_imports (run_id, source_path, source_markdown, include_completed, source_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        runId,
        snapshot.sourcePath,
        snapshot.markdown,
        Number(snapshot.includeCompleted),
        sha256,
        this.clock(),
      );
  }

  taskImport(runId: string): (TaskImportSnapshot & { readonly sourceSha256: string }) | undefined {
    const row = this.database.prepare("SELECT * FROM task_imports WHERE run_id = ?").get(runId) as
      | Raw
      | undefined;
    return row
      ? {
          sourcePath: row["source_path"] as string,
          markdown: row["source_markdown"] as string,
          includeCompleted: row["include_completed"] === 1,
          sourceSha256: row["source_sha256"] as string,
        }
      : undefined;
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
  /** Records bounded stdout and the log location for an attempt that has finished running. */
  setAttemptOutput(attemptId: string, output: { stdout: string; logPath: string | null }): void {
    this.database
      .prepare("UPDATE attempts SET stdout_text = ?, log_path = ? WHERE attempt_id = ?")
      .run(output.stdout, output.logPath, attemptId);
  }

  /** stdout of the latest attempt of `stepId` whose outcome was `complete` (spec §3.4). */
  latestSuccessfulStdout(runId: string, stepId: string): string | undefined {
    const row = this.database
      .prepare(
        "SELECT a.stdout_text AS stdout FROM attempts a JOIN transitions t ON t.attempt_id = a.attempt_id WHERE a.run_id = ? AND a.step_id = ? AND t.outcome = 'complete' ORDER BY a.sequence_no DESC LIMIT 1",
      )
      .get(runId, stepId) as { stdout: string | null } | undefined;
    return row?.stdout ?? undefined;
  }

  /** Marks every open attention item of the run resolved. Items are kept, never deleted. */
  resolveOpenAttention(runId: string, resolution: string): void {
    this.database
      .prepare(
        "UPDATE attention_items SET resolution = ?, resolved_at = ? WHERE run_id = ? AND resolved_at IS NULL",
      )
      .run(resolution, this.clock(), runId);
  }

  countAttempts(runId: string, stepId: string, taskId: string | null): number {
    const row = this.database
      .prepare(
        "SELECT COUNT(*) AS n FROM attempts WHERE run_id = ? AND step_id = ? AND task_id IS ?",
      )
      .get(runId, stepId, taskId) as { n: number };
    return row.n;
  }

  insertAttempt(input: {
    taskOverrides?: TaskOverrides;
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
          "INSERT INTO attempts (attempt_id, run_id, step_id, task_id, revision_id, sequence_no, status, started_at, task_overrides_json) VALUES (?, ?, ?, ?, ?, ?, 'starting', ?, ?)",
        )
        .run(
          input.attemptId,
          input.runId,
          input.stepId,
          input.taskId,
          input.revisionId,
          next.n,
          startedAt,
          JSON.stringify(input.taskOverrides ?? { steps: {} }),
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
      revisionId: (row["revision_id"] as number | null) ?? null,
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

  taskOverrides(taskId: string | null): TaskOverrides {
    const row = this.database
      .prepare("SELECT overrides_json FROM task_overrides WHERE task_id = ?")
      .get(taskId) as { overrides_json: string } | undefined;
    return row ? (JSON.parse(row.overrides_json) as TaskOverrides) : { steps: {} };
  }

  saveTaskOverrides(taskId: string, overrides: TaskOverrides): void {
    this.database
      .prepare(
        "INSERT INTO task_overrides (task_id, overrides_json) VALUES (?, ?) ON CONFLICT(task_id) DO UPDATE SET overrides_json = excluded.overrides_json",
      )
      .run(taskId, JSON.stringify(overrides));
  }
}

/** Task IDs are unique across runs because they include the run ID and the source position. */
export function taskIdFor(runId: string, sourceOrder: number): string {
  return `${runId}.t${sourceOrder}`;
}

function toAttempt(row: Raw): AttemptRow {
  return {
    taskOverrides: JSON.parse(row["task_overrides_json"] as string) as TaskOverrides,
    attemptId: row["attempt_id"] as string,
    runId: row["run_id"] as string,
    stepId: row["step_id"] as string,
    taskId: (row["task_id"] as string | null) ?? null,
    revisionId: row["revision_id"] as number,
    sequenceNo: row["sequence_no"] as number,
    sessionId: row["session_id"] as string | null,
    correctionCount: row["correction_count"] as number,
    status: row["status"] as AttemptStatus,
    startedAt: row["started_at"] as string,
    finishedAt: (row["finished_at"] as string | null) ?? null,
    exitCode: (row["exit_code"] as number | null) ?? null,
    errorCode: (row["error_code"] as string | null) ?? null,
  };
}
