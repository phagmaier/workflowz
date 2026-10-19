/**
 * The run coordinator: the only code that changes a run's persisted state (architecture §2.1).
 *
 * Each change follows the same shape. Read the run, decide with the pure reducer, then write the
 * decision together with its event, all in one transaction, so a failed write leaves nothing
 * half-applied. A settlement with an undeclared outcome is refused before any write (spec §4.2).
 *
 * The coordinator never starts a process. An agent or command attempt is handed to the caller as
 * `attempt`, and the caller reports back with `settle`. The runner (src/runner) owns processes.
 */
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { AgentInputSnapshot } from "../contracts/agent-context.js";
import type { Diagnostic } from "../contracts/diagnostics.js";
import { hasErrors } from "../contracts/diagnostics.js";
import { isReservedName, isSystemOutcome, type SystemOutcome } from "../contracts/identifiers.js";
import { parseWorkflowText } from "../contracts/parse-workflow.js";
import {
  type ProcessIdentity,
  type ProcessObservation,
  processIdentitySchema,
} from "../contracts/process-identity.js";
import {
  type ExternalCleanupConfirmation,
  externalCleanupSchema,
  type RecoveryDecision,
  type RecoveryRequest,
  recoveryDecisionSchema,
  recoveryRequestSchema,
} from "../contracts/recovery.js";
import { ReportRejected, validateReport } from "../contracts/report.js";
import {
  type TaskOverrides,
  taskOverrideEditSchema,
  workflowRevisionSchema,
} from "../contracts/run-configuration.js";
import {
  ACTIVE_ATTEMPT_STATUSES,
  type AttemptStatus,
  type AttentionSeverity,
  type RunStatus,
} from "../contracts/run-state.js";
import { previewMarkdownTasks, type TaskImportSnapshot } from "../contracts/task-import.js";
import type { WorkflowDatabase } from "../store/database.js";
import {
  type AttemptRow,
  type NewTask,
  type RecoveryResolutionRow,
  type ReportRow,
  type RunRow,
  RunStore,
  type TaskRow,
} from "../store/run-store.js";
import { checkWorkflowText } from "./check.js";
import { compileWorkflow } from "./compile.js";
import type { CompiledWorkflow } from "./model.js";
import {
  completeActiveTask,
  type Decision,
  routeAttempt,
  routeEngineStep,
  selectNextTask,
} from "./reducer.js";
import { revisionCursor, specializeTask } from "./run-configuration.js";

/** Upper bound on consecutive engine-only steps in one `advance` call. Beyond it the run pauses. */
export const MAX_ENGINE_STEPS_PER_ADVANCE = 10_000;

const USER_PAUSE_MESSAGE = "the run was paused by request; it stops before the next step";

export class WorkflowInvalidError extends Error {
  constructor(readonly diagnostics: readonly Diagnostic[]) {
    super(
      `workflow is invalid: ${diagnostics
        .filter((d) => d.severity === "error")
        .map((d) => d.code)
        .join(", ")}`,
    );
    this.name = "WorkflowInvalidError";
  }
}

export class RunStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunStateError";
  }
}

export class UnknownAttemptError extends Error {
  constructor(attemptId: string) {
    super(`no attempt ${attemptId}`);
    this.name = "UnknownAttemptError";
  }
}

export class AttemptNotActiveError extends Error {
  constructor(attemptId: string, status: AttemptStatus) {
    super(`attempt ${attemptId} is already ${status}; a second settlement is rejected`);
    this.name = "AttemptNotActiveError";
  }
}

export class UndeclaredOutcomeError extends Error {
  constructor(
    readonly outcome: string,
    readonly stepId: string,
    readonly declared: readonly string[],
  ) {
    super(
      `outcome '${outcome}' is not declared by step '${stepId}'; declared outcomes are ${declared.join(", ")}`,
    );
    this.name = "UndeclaredOutcomeError";
  }
}

export type AdvanceResult =
  | {
      readonly kind: "attempt";
      readonly attemptId: string;
      readonly stepId: string;
      readonly taskId: string | null;
    }
  | { readonly kind: "in_progress"; readonly attemptId: string; readonly stepId: string }
  | { readonly kind: "completed" }
  | { readonly kind: "not_running"; readonly status: RunStatus };

/** What the caller observed about an attempt. A system settlement comes from the runner, never an agent. */
export type Settlement =
  | { readonly kind: "outcome"; readonly outcome: string }
  | { readonly kind: "system"; readonly code: SystemOutcome; readonly detail?: string };

export interface SettleResult {
  readonly outcome: string;
  readonly decision: Decision;
}

export interface AttemptOutput {
  readonly stdout: string;
  readonly logPath: string | null;
}

export interface CoordinatorOptions {
  readonly now?: () => string;
  readonly newId?: (prefix: string) => string;
  /** Overrides MAX_ENGINE_STEPS_PER_ADVANCE; tests lower it to keep loop checks fast. */
  readonly maxEngineStepsPerAdvance?: number;
}

export interface CreateRunInput {
  readonly workflowText: string;
  /** Directory the workflow file lives in; project paths resolve against it. */
  readonly workflowDir: string;
  readonly tasks?: readonly NewTask[];
  readonly taskImport?: TaskImportSnapshot;
}

/** Operator inspection keeps reported results, process evidence and manual resolution distinct. */
export interface RecoverySnapshot {
  readonly run: RunRow;
  readonly attempt: AttemptRow | null;
  readonly report: ReportRow | null;
  readonly logPaths: readonly string[];
  readonly resolution: RecoveryResolutionRow | null;
  readonly processResolved: boolean;
  readonly expectedEventId: number;
  readonly actions: readonly string[];
}

export class RunCoordinator {
  private readonly store: RunStore;
  private readonly now: () => string;
  private readonly newId: (prefix: string) => string;
  private readonly compiledByRevision = new Map<string, CompiledWorkflow>();
  private readonly maxEngineSteps: number;

  constructor(
    private readonly database: WorkflowDatabase,
    options: CoordinatorOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.store = new RunStore(database, this.now);
    this.newId = options.newId ?? ((prefix) => `${prefix}_${randomUUID()}`);
    this.maxEngineSteps = options.maxEngineStepsPerAdvance ?? MAX_ENGINE_STEPS_PER_ADVANCE;
  }

  /** Validates the workflow, records its revision, and creates a run in state `ready`. */
  createRun(input: CreateRunInput): string {
    const checked = checkWorkflowText(input.workflowText, { workflowDir: input.workflowDir });
    if (!checked.compiled || hasErrors(checked.diagnostics)) {
      throw new WorkflowInvalidError(checked.diagnostics);
    }
    const compiled = checked.compiled;
    if (input.tasks !== undefined && input.taskImport !== undefined)
      throw new RunStateError("supply a Markdown import or explicit task records, not both");
    const preview =
      input.taskImport === undefined ? undefined : previewMarkdownTasks(input.taskImport);
    if (input.taskImport && input.taskImport.sourcePath !== compiled.tasksSourcePath)
      throw new RunStateError("task snapshot source does not match the workflow tasks.source");
    const tasks = preview?.runnable ?? input.tasks ?? [];
    if (tasks.length > 0 && compiled.tasksSourcePath === undefined) {
      throw new RunStateError("tasks were supplied, but the workflow declares no tasks.source");
    }
    const sourceDir = path.resolve(input.workflowDir);
    return this.database.transaction(() => {
      const revisionId = this.store.saveRevision(
        input.workflowText,
        checked.sourceSha256,
        sourceDir,
      );
      const runId = this.newId("run");
      this.store.createRun({
        runId,
        revisionId,
        projectRoot: compiled.projectRoot,
        startStepId: compiled.start,
        tasks,
      });
      if (input.taskImport && preview) {
        const sourceSha256 = createHash("sha256").update(input.taskImport.markdown).digest("hex");
        this.store.saveTaskImport(runId, input.taskImport, sourceSha256);
        this.store.appendEvent({
          runId,
          revisionId,
          type: "tasks_imported",
          data: {
            total: preview.total,
            prechecked: preview.prechecked,
            runnable: preview.runnableCount,
            sourceSha256,
          },
        });
      }
      this.compiledByRevision.set(JSON.stringify([checked.sourceSha256, sourceDir]), compiled);
      return runId;
    });
  }

  /** `ready` → `running`. Any other status is refused. */
  start(runId: string): void {
    this.database.transaction(() => {
      const run = this.store.getRun(runId);
      if (run.status !== "ready") {
        throw new RunStateError(`run ${runId} is ${run.status}; only a ready run can start`);
      }
      this.assertNoUnresolvedProcess();
      const activeRunId = this.store.activeRunId();
      if (activeRunId !== undefined) {
        throw new RunStateError(
          `run ${activeRunId} is already active; only one run can run at a time`,
        );
      }
      this.store.updateRun(runId, { status: "running", startTime: this.now() });
      this.store.appendEvent({ runId, revisionId: run.revisionId, type: "run_started" });
    });
  }

  /**
   * Runs engine-only steps in place until the cursor reaches an agent or command step (which becomes
   * an attempt), the run finishes, or the run stops. An active attempt is returned as `in_progress`,
   * so a second one never starts while the first is unsettled.
   */
  advance(runId: string): AdvanceResult {
    const status = this.store.getRun(runId).status;
    if (status === "running" || status === "pausing") this.assertNoUnresolvedProcess();
    for (let steps = 0; ; steps += 1) {
      const result = this.database.transaction(() =>
        this.advanceOnce(runId, steps < this.maxEngineSteps),
      );
      if (result !== "continue") {
        return result;
      }
    }
  }

  /**
   * Records what happened to an attempt and routes it. Exactly one transition is committed per
   * attempt, and a second settlement is refused.
   */
  settle(attemptId: string, settlement: Settlement): SettleResult {
    return this.database.transaction(() => {
      const attempt = this.store.getAttempt(attemptId);
      if (!attempt) {
        throw new UnknownAttemptError(attemptId);
      }
      if (!(ACTIVE_ATTEMPT_STATUSES as readonly string[]).includes(attempt.status)) {
        throw new AttemptNotActiveError(attemptId, attempt.status);
      }
      const run = this.store.getRun(attempt.runId);
      if (run.status !== "running" && run.status !== "pausing") {
        throw new RunStateError(
          `run ${run.runId} is ${run.status}; attempts settle only while running`,
        );
      }
      const compiled = this.workflowForAttempt(attempt);
      const step = compiled.steps.get(attempt.stepId);
      if (!step) {
        throw new RunStateError(`attempt ${attemptId} refers to unknown step '${attempt.stepId}'`);
      }

      let outcome: string;
      if (settlement.kind === "system") {
        outcome = settlement.code;
      } else {
        outcome = settlement.outcome;
        if (
          isSystemOutcome(outcome) ||
          isReservedName(outcome) ||
          !step.outcomes.includes(outcome)
        ) {
          throw new UndeclaredOutcomeError(outcome, step.id, step.outcomes);
        }
      }

      const attemptsSoFar = this.store.countAttempts(run.runId, step.id, attempt.taskId);
      const decision = routeAttempt(compiled, step.id, outcome, attemptsSoFar);
      const finalStatus: AttemptStatus = settlement.kind === "system" ? "failed" : "succeeded";
      this.store.setAttemptStatus(
        attemptId,
        finalStatus,
        settlement.kind === "system" ? { errorCode: settlement.code } : undefined,
      );
      this.store.appendEvent({
        runId: run.runId,
        attemptId,
        revisionId: run.revisionId,
        type: "attempt_settled",
        data: {
          outcome,
          status: finalStatus,
          ...(settlement.kind === "system" && settlement.detail !== undefined
            ? { detail: settlement.detail }
            : {}),
        },
      });
      this.commitRouting(run, step.id, outcome, attemptId, decision, `attempt ${attemptId}`);
      if (run.status === "pausing" && decision.kind !== "pause") {
        this.pauseRun(run, USER_PAUSE_MESSAGE, "user_pause", attemptId, "info");
      }
      return { outcome, decision };
    });
  }

  latestReport(runId: string, stepId: string, taskId: string | null) {
    return this.store.latestReport(runId, stepId, taskId);
  }

  attemptInput(attemptId: string) {
    return this.store.attemptInput(attemptId);
  }

  recordInput(attemptId: string, input: AgentInputSnapshot): void {
    this.database.transaction(() => {
      const attempt = this.store.getAttempt(attemptId);
      if (!attempt || !ACTIVE_ATTEMPT_STATUSES.includes(attempt.status))
        throw new RunStateError("input attempt is not active");
      this.store.saveAttemptInput(attemptId, input);
      this.store.appendEvent({
        runId: attempt.runId,
        attemptId,
        revisionId: attempt.revisionId,
        type: "attempt_prepared",
        data: {},
      });
    });
  }

  /** Accepting a report never settles an attempt or moves its cursor. */
  acceptReport(attemptId: string, body: unknown) {
    return this.database.transaction(() => {
      const attempt = this.store.getAttempt(attemptId);
      if (!attempt || !ACTIVE_ATTEMPT_STATUSES.includes(attempt.status)) {
        throw new ReportRejected(410, "report attempt is expired or no longer active");
      }
      const run = this.store.getRun(attempt.runId);
      if (run.status !== "running" && run.status !== "pausing") {
        throw new ReportRejected(410, "report attempt is no longer running");
      }
      const step = this.compiledFor(attempt.revisionId).steps.get(attempt.stepId);
      if (step?.kind !== "agent")
        throw new ReportRejected(422, "only agent attempts accept reports");
      const report = validateReport(body, step.outcomes);
      if (this.store.getReport(attemptId))
        throw new ReportRejected(409, "a report was already accepted for this attempt");
      const accepted = this.store.insertReport(attemptId, report);
      this.store.appendEvent({
        runId: attempt.runId,
        attemptId,
        revisionId: attempt.revisionId,
        type: "report_accepted",
        data: { reportId: accepted.reportId, outcome: accepted.outcome },
      });
      return accepted;
    });
  }

  reportFor(attemptId: string) {
    return this.store.getReport(attemptId);
  }

  /** Replaces one unfinished task's run-local settings; an empty steps map clears them. */
  setTaskOverrides(runId: string, taskId: string, body: unknown): void {
    this.database.transaction(() => {
      const edit = taskOverrideEditSchema.parse(body);
      const run = this.requireConfigurationEdit(runId);
      const task = this.store.listTasks(runId).find((task) => task.taskId === taskId);
      if (!task || task.state === "completed")
        throw new RunStateError(`task '${taskId}' must be an unfinished task of run ${runId}`);
      this.taskWorkflow(run.revisionId, edit.overrides);
      const previous = this.store.taskOverrides(taskId);
      this.store.saveTaskOverrides(taskId, edit.overrides);
      this.store.appendEvent({
        runId,
        revisionId: run.revisionId,
        type: "task_overrides_changed",
        data: { taskId, previous, overrides: edit.overrides, reason: edit.reason },
      });
    });
  }

  /** Immutable definition revision for future dispatches, never a rewrite of task/attempt history. */
  reviseWorkflow(runId: string, body: unknown): number {
    return this.database.transaction(() => {
      const edit = workflowRevisionSchema.parse(body);
      const run = this.requireConfigurationEdit(runId);
      const previous = this.compiledFor(run.revisionId);
      const sourceDir = this.store.getRevision(run.revisionId).sourceDir;
      const checked = checkWorkflowText(edit.workflowText, { workflowDir: sourceDir });
      if (!checked.compiled) throw new WorkflowInvalidError(checked.diagnostics);
      const revised = checked.compiled;
      if (
        revised.projectRoot !== previous.projectRoot ||
        revised.tasksSourcePath !== previous.tasksSourcePath
      )
        throw new RunStateError(
          "a revision cannot change project.root or tasks.source; create a new run to import different tasks",
        );
      const cursorStepId = revisionCursor(
        previous,
        revised,
        run.cursorStepId,
        run.activeTaskId,
        edit.cursorStepId,
      );
      // Remaining task settings must also remain valid. Completed task settings stay as history.
      const document = parseWorkflowText(edit.workflowText).document;
      if (!document) throw new WorkflowInvalidError(checked.diagnostics);
      for (const task of this.store.listTasks(runId)) {
        if (task.state === "completed") continue;
        const specialized = compileWorkflow(
          specializeTask(document, this.store.taskOverrides(task.taskId)),
          { workflowDir: sourceDir },
        );
        if (!specialized.compiled) throw new WorkflowInvalidError(specialized.diagnostics);
      }
      const revisionId = this.store.saveRevision(
        edit.workflowText,
        checked.sourceSha256,
        sourceDir,
      );
      this.store.updateRun(runId, { revisionId, cursorStepId });
      this.store.appendEvent({
        runId,
        revisionId,
        type: "workflow_revised",
        data: {
          previousRevisionId: run.revisionId,
          revisionId,
          from: run.cursorStepId,
          to: cursorStepId,
          explicitCursor: edit.cursorStepId !== undefined,
          reason: edit.reason,
          sessions: "same_revision_only",
        },
      });
      return revisionId;
    });
  }

  taskOverrides(runId: string, taskId: string): TaskOverrides {
    if (!this.store.listTasks(runId).some((task) => task.taskId === taskId))
      throw new RunStateError(`run ${runId} has no task '${taskId}'`);
    return this.store.taskOverrides(taskId);
  }

  workflowForAttempt(attempt: AttemptRow): CompiledWorkflow {
    return this.taskWorkflow(attempt.revisionId, attempt.taskOverrides);
  }

  /** Resume the most recent persisted agent session for this harness, task and revision. */
  priorSession(attempt: AttemptRow): string | undefined {
    const compiled = this.compiledFor(attempt.revisionId);
    const current = compiled.steps.get(attempt.stepId)?.spec;
    if (current?.kind !== "agent") return undefined;
    return (
      this.store
        .listAttempts(attempt.runId)
        .filter((row) => {
          const prior = compiled.steps.get(row.stepId)?.spec;
          return (
            row.sequenceNo < attempt.sequenceNo &&
            row.taskId === attempt.taskId &&
            row.revisionId === attempt.revisionId &&
            row.sessionId !== null &&
            prior?.kind === "agent" &&
            prior.harness === current.harness
          );
        })
        .at(-1)?.sessionId ?? undefined
    );
  }

  /** A durable budget, separate from workflow retry attempts. */
  requestCorrection(attemptId: string): void {
    this.database.transaction(() => {
      const attempt = this.store.getAttempt(attemptId);
      if (
        !attempt ||
        !ACTIVE_ATTEMPT_STATUSES.includes(attempt.status) ||
        attempt.correctionCount !== 0 ||
        !attempt.sessionId ||
        this.store.getReport(attemptId)
      ) {
        throw new RunStateError("report correction is unavailable or was already requested");
      }
      const run = this.store.getRun(attempt.runId);
      if (
        (run.status !== "running" && run.status !== "pausing") ||
        this.compiledFor(attempt.revisionId).reportCorrectionAttempts !== 1
      ) {
        throw new RunStateError("report correction is disabled or run is no longer active");
      }
      this.store.reserveCorrection(attemptId);
      this.store.appendEvent({
        runId: attempt.runId,
        attemptId,
        revisionId: attempt.revisionId,
        type: "correction_requested",
        data: { invocation: 1 },
      });
    });
  }

  /** Commit invocation intent before spawn; a crash in the spawn/persist gap stays unidentified. */
  prepareInvocation(attemptId: string, invocation: 0 | 1): void {
    this.database.transaction(() => {
      const attempt = this.store.getAttempt(attemptId);
      if (!attempt || !ACTIVE_ATTEMPT_STATUSES.includes(attempt.status))
        throw new RunStateError("invocation attempt is not active");
      this.store.clearProcess(attemptId);
      this.store.appendEvent({
        runId: attempt.runId,
        attemptId,
        revisionId: attempt.revisionId,
        type: "invocation_dispatching",
        data: { invocation },
      });
    });
  }

  recordInvocation(
    attemptId: string,
    invocation: 0 | 1,
    phase: "started" | "settled",
    details: {
      pid: number | null;
      processIdentity?: ProcessIdentity | null;
      sessionId?: string | undefined;
      logPath?: string | undefined;
      exitCode?: number | null;
      timedOut?: boolean;
      failure?: SystemOutcome | undefined;
      harnessVersion?: string;
      permissionMode?: string;
      diagnostics?: {
        stderr: string;
        stdoutTruncated: boolean;
        stderrTruncated: boolean;
      };
    },
  ): void {
    this.database.transaction(() => {
      const attempt = this.store.getAttempt(attemptId);
      if (!attempt || !ACTIVE_ATTEMPT_STATUSES.includes(attempt.status))
        throw new RunStateError("invocation attempt is not active");
      const identity =
        details.processIdentity == null
          ? null
          : processIdentitySchema.parse(details.processIdentity);
      if (
        identity &&
        (identity.pid !== details.pid ||
          identity.pgid !== identity.pid ||
          identity.sid !== identity.pid)
      )
        throw new RunStateError("invocation process identity does not match its process group");
      this.store.setProcess(attemptId, details.pid, identity, details.sessionId ?? null);
      this.store.appendEvent({
        runId: attempt.runId,
        attemptId,
        revisionId: attempt.revisionId,
        type: phase === "started" ? "invocation_started" : "invocation_settled",
        data: { invocation, ...details },
      });
    });
  }

  /** Stores bounded stdout and the log location for an attempt. Called before it settles. */
  recordOutput(attemptId: string, output: AttemptOutput): void {
    this.store.setAttemptOutput(attemptId, output);
  }

  /**
   * Pause after the current step (spec §2.3). With no attempt running, the run pauses now. With one
   * running, it pauses as soon as that attempt has settled and been routed.
   */
  requestPause(runId: string): void {
    this.database.transaction(() => {
      const run = this.store.getRun(runId);
      if (run.status === "pausing") {
        return;
      }
      if (run.status !== "running") {
        throw new RunStateError(`run ${runId} is ${run.status}; only a running run can be paused`);
      }
      if (this.store.activeAttempt(runId)) {
        this.store.updateRun(runId, { status: "pausing" });
        this.store.appendEvent({ runId, revisionId: run.revisionId, type: "pause_requested" });
      } else {
        this.pauseRun(run, USER_PAUSE_MESSAGE, "user_pause", null, "info");
      }
    });
  }

  /** `paused` or `interrupted` → `running`. The cursor step runs again from its beginning. */
  resume(runId: string, note?: string): void {
    this.database.transaction(() => {
      const run = this.store.getRun(runId);
      if (run.status !== "paused" && run.status !== "interrupted") {
        throw new RunStateError(
          `run ${runId} is ${run.status}; only a paused or interrupted run can resume`,
        );
      }
      if (run.status === "interrupted" && !note?.trim())
        throw new RunStateError(
          "resuming an interrupted run requires a reason acknowledging uncertain side effects",
        );
      this.assertNoUnresolvedProcess();
      const activeRunId = this.store.activeRunId();
      if (activeRunId !== undefined) {
        throw new RunStateError(
          `run ${activeRunId} is already active; only one run can run at a time`,
        );
      }
      this.store.updateRun(runId, { status: "running" });
      this.store.resolveOpenAttention(runId, note ?? "resumed");
      this.store.appendEvent({
        runId,
        revisionId: run.revisionId,
        type: "run_resumed",
        data: note === undefined ? {} : { note },
      });
    });
  }

  /**
   * Stop now (spec §6). The caller must have terminated any running process first; this method
   * records the outcome, so no completed step is reported for the stopped one.
   */
  recordStop(runId: string, reason: string): void {
    this.database.transaction(() => {
      const run = this.store.getRun(runId);
      if (run.status === "completed" || run.status === "stopped") {
        throw new RunStateError(`run ${runId} is already ${run.status}`);
      }
      if (this.store.pendingRecovery(runId))
        throw new RunStateError(
          "the run has an unresolved process; reconcile it before recording a stop",
        );
      const active = this.store.activeAttempt(runId);
      if (active) {
        this.store.setAttemptStatus(active.attemptId, "interrupted", { errorCode: "stopped" });
        this.store.appendEvent({
          runId,
          attemptId: active.attemptId,
          revisionId: run.revisionId,
          type: "attempt_settled",
          data: { status: "interrupted", reason: "stopped" },
        });
      }
      this.store.updateRun(runId, { status: "stopped", endTime: this.now() });
      this.store.appendEvent({
        runId,
        revisionId: run.revisionId,
        type: "run_stopped",
        data: { reason },
      });
    });
  }

  /** Startup observations are supplied by the runner; the coordinator performs no process I/O. */
  reconcileAfterRestart(runId: string, observation: ProcessObservation = "unknown"): boolean {
    return this.database.transaction(() => {
      const run = this.store.getRun(runId);
      const active = this.store.activeAttempt(runId);
      const pending = this.store.pendingRecovery(runId);
      const attempt = active ?? pending;
      const restarting = run.status === "running" || run.status === "pausing";
      if (!restarting && !pending) return false;
      if (!restarting && attempt?.recoveryState === observation) return false;
      if (attempt) {
        if (active)
          this.store.setAttemptStatus(active.attemptId, "interrupted", {
            errorCode: "uncertain_after_restart",
          });
        this.store.setRecoveryState(attempt.attemptId, observation);
      }
      if (restarting) this.store.updateRun(runId, { status: "interrupted" });
      this.store.appendEvent({
        runId,
        attemptId: attempt?.attemptId ?? null,
        revisionId: attempt?.revisionId ?? run.revisionId,
        type: restarting ? "run_interrupted" : "process_reconciled",
        data: {
          stepId: attempt?.stepId ?? run.cursorStepId,
          processState: attempt ? observation : "gone",
        },
      });
      if (restarting)
        this.store.insertAttention({
          runId,
          attemptId: attempt?.attemptId ?? null,
          category: attempt ? "uncertain_attempt" : "interrupted_run",
          severity: "blocking",
          message: attempt
            ? `step '${attempt.stepId}' was interrupted; its side effects are unknown. Process state: ${observation}. Reconcile surviving or unidentified processes before explicitly resuming; resume runs the step again.`
            : "the runner stopped between steps; no work was replayed. Review the committed history before explicitly resuming.",
        });
      return true;
    });
  }

  /** Consistent recovery view. The event cursor binds decisions to exactly the state inspected. */
  recovery(runId: string): RecoverySnapshot {
    return this.database.transaction(() => {
      const run = this.store.getRun(runId);
      const pending = this.store.pendingRecovery(runId);
      const events = this.store.listEvents(runId);
      const interruptedId = events.findLast((event) => event.type === "run_interrupted")?.attemptId;
      const latest = pending ?? (interruptedId ? this.store.getAttempt(interruptedId) : undefined);
      const attempt =
        latest?.status === "interrupted" && latest.errorCode === "uncertain_after_restart"
          ? latest
          : null;
      const resolution = attempt
        ? (this.store.recoveryResolution(attempt.attemptId) ?? null)
        : null;
      const processResolved = pending === undefined;
      return {
        run,
        attempt,
        report: attempt ? (this.store.getReport(attempt.attemptId) ?? null) : null,
        logPaths: attempt
          ? events
              .filter(
                (event) =>
                  event.attemptId === attempt.attemptId && event.type === "invocation_started",
              )
              .flatMap((event) =>
                typeof event.data["logPath"] === "string" ? [event.data["logPath"]] : [],
              )
          : [],
        resolution,
        processResolved,
        expectedEventId: this.store.latestEventId(runId),
        actions:
          run.status !== "interrupted"
            ? []
            : processResolved
              ? [attempt ? "retry" : "continue", "skip", "jump", "end"]
              : attempt?.processIdentity && attempt.recoveryState === "alive"
                ? ["terminate", "confirm_external_cleanup"]
                : ["confirm_external_cleanup"],
      };
    });
  }

  private requireRecovery(runId: string, request: RecoveryRequest) {
    const state = this.recovery(runId);
    if (state.run.status !== "interrupted" || this.store.activeAttempt(runId))
      throw new RunStateError(
        "recovery actions require an interrupted run without an active attempt",
      );
    if (
      state.expectedEventId !== request.expectedEventId ||
      (state.attempt?.attemptId ?? null) !== request.attemptId
    )
      throw new RunStateError("recovery state changed; inspect it again before deciding");
    return state;
  }

  confirmExternalCleanup(
    runId: string,
    input: ExternalCleanupConfirmation,
    observation: ProcessObservation,
  ): void {
    const request = externalCleanupSchema.parse(input);
    this.database.transaction(() => {
      const state = this.requireRecovery(runId, request);
      if (!state.attempt || state.processResolved)
        throw new RunStateError("this operation has no unresolved process barrier");
      if (observation === "alive")
        throw new RunStateError(
          "a verified owned process is still alive; terminate it before confirming cleanup",
        );
      this.store.confirmRecovery(state.attempt.attemptId, observation, request.reason);
      this.store.appendEvent({
        runId,
        attemptId: state.attempt.attemptId,
        revisionId: state.attempt.revisionId,
        type: "recovery_cleanup_confirmed",
        data: {
          reason: request.reason,
          previousObservation: state.attempt.recoveryState,
          observation,
          confirmedNoSurvivingOperation: true,
        },
      });
    });
  }

  requestRecoveryTermination(
    runId: string,
    input: RecoveryRequest,
    observation: ProcessObservation,
  ) {
    const request = recoveryRequestSchema.parse(input);
    return this.database.transaction(() => {
      const state = this.requireRecovery(runId, request);
      const attempt = state.attempt;
      if (
        !attempt?.processIdentity ||
        state.processResolved ||
        (observation !== "alive" && observation !== "gone")
      )
        throw new RunStateError("recovery termination requires verified process-group ownership");
      this.store.appendEvent({
        runId,
        attemptId: attempt.attemptId,
        revisionId: attempt.revisionId,
        type: "recovery_termination_requested",
        data: { reason: request.reason, observation, processIdentity: attempt.processIdentity },
      });
      return { ...request, expectedEventId: this.store.latestEventId(runId), attempt };
    });
  }

  finishRecoveryTermination(
    runId: string,
    request: RecoveryRequest,
    observation: ProcessObservation,
  ): void {
    this.database.transaction(() => {
      const state = this.requireRecovery(runId, request);
      if (!state.attempt) throw new RunStateError("recovered attempt is unavailable");
      if (state.attempt.recoveryState !== observation) {
        this.store.setRecoveryState(state.attempt.attemptId, observation);
        this.store.appendEvent({
          runId,
          attemptId: state.attempt.attemptId,
          revisionId: state.attempt.revisionId,
          type: "process_reconciled",
          data: { stepId: state.attempt.stepId, processState: observation },
        });
      }
      this.store.appendEvent({
        runId,
        attemptId: state.attempt.attemptId,
        revisionId: state.attempt.revisionId,
        type: "recovery_termination_finished",
        data: {
          requestEventId: request.expectedEventId,
          processState: observation,
          confirmedAbsent: observation === "gone",
        },
      });
    });
  }

  /** Decide what comes next, but never dispatch it or settle the interrupted attempt as success. */
  decideRecovery(runId: string, input: RecoveryDecision): void {
    const request = recoveryDecisionSchema.parse(input);
    this.database.transaction(() => {
      const state = this.requireRecovery(runId, request);
      this.assertNoUnresolvedProcess();
      const compiled = this.taskWorkflow(
        state.run.revisionId,
        this.store.taskOverrides(state.run.activeTaskId),
      );
      if (request.action === "retry" && !state.attempt)
        throw new RunStateError(
          "there is no interrupted stage to retry; continue the committed cursor",
        );
      if (request.action === "continue" && state.attempt)
        throw new RunStateError(
          "an interrupted stage requires an explicit retry, skip, jump or end decision",
        );
      // A prior audited manual jump may have changed the cursor; retry still names the interrupted stage.
      const retryStepId = request.action === "retry" ? state.attempt?.stepId : undefined;
      if (request.action !== "end" && request.action !== "skip")
        revisionCursor(
          compiled,
          compiled,
          state.run.cursorStepId,
          state.run.activeTaskId,
          request.action === "jump" ? request.stepId : retryStepId,
        );
      if (request.action === "end") {
        this.recordStop(runId, request.reason);
        this.store.resolveOpenAttention(runId, request.reason);
      } else {
        this.store.updateRun(runId, {
          status: "paused",
          ...(retryStepId === undefined ? {} : { cursorStepId: retryStepId }),
        });
        if (request.action === "jump") this.jumpTo(runId, request.stepId, request.reason);
        if (request.action === "skip") this.skipCurrentStep(runId, request.outcome, request.reason);
      }
      this.store.appendEvent({
        runId,
        attemptId: state.attempt?.attemptId ?? null,
        revisionId: state.run.revisionId,
        type: "recovery_decided",
        data: {
          ...request,
          from: state.run.cursorStepId,
          to: this.store.getRun(runId).cursorStepId,
        },
      });
    });
  }

  recoveryRuns(): string[] {
    return this.store.recoveryRuns();
  }

  recoveryAttempt(runId: string): AttemptRow | undefined {
    return this.store.activeAttempt(runId) ?? this.store.pendingRecovery(runId);
  }

  private assertNoUnresolvedProcess(): void {
    const pending = this.store.pendingRecovery();
    if (pending)
      throw new RunStateError(
        `run ${pending.runId} has an unresolved process; reconcile it before starting or resuming work`,
      );
  }

  /** Manual override: move the cursor to a declared step. Requires a paused or interrupted run and a reason. */
  jumpTo(runId: string, stepId: string, reason: string): void {
    this.database.transaction(() => {
      const run = this.requireManualEdit(runId, reason);
      const compiled = this.taskWorkflow(
        run.revisionId,
        this.store.taskOverrides(run.activeTaskId),
      );
      if (!compiled.steps.has(stepId)) {
        throw new RunStateError(`cannot jump to '${stepId}': the workflow declares no such step`);
      }
      this.store.updateRun(runId, { cursorStepId: stepId });
      this.store.appendEvent({
        runId,
        revisionId: run.revisionId,
        type: "manual_override",
        data: { action: "jump", from: run.cursorStepId, to: stepId, reason },
      });
    });
  }

  /**
   * Manual override: skip the cursor step by taking one of its declared outcomes without running it.
   * The transition is recorded with no attempt, so it is distinguishable from a real result.
   */
  skipCurrentStep(runId: string, outcome: string, reason: string): void {
    this.database.transaction(() => {
      const run = this.requireManualEdit(runId, reason);
      const compiled = this.taskWorkflow(
        run.revisionId,
        this.store.taskOverrides(run.activeTaskId),
      );
      const step = compiled.steps.get(run.cursorStepId);
      if (!step) {
        throw new RunStateError(
          `run ${runId} has cursor '${run.cursorStepId}', which the workflow does not declare`,
        );
      }
      if (!step.outcomes.includes(outcome)) {
        throw new UndeclaredOutcomeError(outcome, step.id, step.outcomes);
      }
      this.store.appendEvent({
        runId,
        revisionId: run.revisionId,
        type: "manual_override",
        data: { action: "skip", stepId: step.id, outcome, reason },
      });
      this.commitRouting(
        run,
        step.id,
        outcome,
        null,
        routeEngineStep(compiled, step.id, outcome),
        `manual skip of '${step.id}'`,
      );
    });
  }

  /** Manual override: mark a task complete without running its steps. Requires a reason. */
  markTaskComplete(runId: string, taskId: string, reason: string): void {
    this.database.transaction(() => {
      const run = this.requireManualEdit(runId, reason);
      const task = this.store.listTasks(runId).find((row) => row.taskId === taskId);
      if (!task) {
        throw new RunStateError(`run ${runId} has no task ${taskId}`);
      }
      if (task.state === "completed") {
        throw new RunStateError(`task ${taskId} is already completed`);
      }
      this.store.setTaskState(taskId, "completed");
      if (run.activeTaskId === taskId) {
        this.store.updateRun(runId, { activeTaskId: null });
      }
      this.store.appendEvent({
        runId,
        revisionId: run.revisionId,
        type: "manual_override",
        data: { action: "mark_task_complete", taskId, reason },
      });
      this.store.appendEvent({
        runId,
        revisionId: run.revisionId,
        type: "task_completed",
        data: { taskId, manual: true },
      });
    });
  }

  /** The attempt currently marked active for a run, if any. */
  activeAttempt(runId: string): AttemptRow | undefined {
    return this.store.activeAttempt(runId);
  }

  /** The run row, without its event history. Cheap enough to read before every step. */
  run(runId: string): RunRow {
    return this.store.getRun(runId);
  }

  /** The compiled workflow a run was started from. Read-only; used by the runner to prepare attempts. */
  workflowFor(runId: string): CompiledWorkflow {
    return this.compiledFor(this.store.getRun(runId).revisionId);
  }

  /** Effective settings for the current task before an attempt freezes its own snapshot. */
  workflowForCurrentTask(runId: string): CompiledWorkflow {
    const run = this.store.getRun(runId);
    return this.taskWorkflow(run.revisionId, this.store.taskOverrides(run.activeTaskId));
  }

  /** Task rows for a run, in source order. */
  tasks(runId: string): TaskRow[] {
    return this.store.listTasks(runId);
  }

  /** stdout of the latest successful run of a command step, for `{{steps.<id>.stdout}}`. */
  latestStdout(runId: string, stepId: string): string | undefined {
    return this.store.latestSuccessfulStdout(runId, stepId);
  }

  /** Read-only view of a run's persisted state, for inspection and tests. */
  inspect(runId: string): {
    run: RunRow;
    tasks: TaskRow[];
    taskImport: ReturnType<RunStore["taskImport"]>;
    activeAttempt: AttemptRow | undefined;
    attempts: AttemptRow[];
    transitions: ReturnType<RunStore["listTransitions"]>;
    events: ReturnType<RunStore["listEvents"]>;
    attention: ReturnType<RunStore["listAttention"]>;
  } {
    return this.database.transaction(() => ({
      run: this.store.getRun(runId),
      tasks: this.store.listTasks(runId),
      taskImport: this.store.taskImport(runId),
      activeAttempt: this.store.activeAttempt(runId),
      attempts: this.store.listAttempts(runId),
      transitions: this.store.listTransitions(runId),
      events: this.store.listEvents(runId),
      attention: this.store.listAttention(runId),
    }));
  }

  private requireManualEdit(runId: string, reason: string): RunRow {
    if (reason.trim().length === 0) {
      throw new RunStateError("a manual override needs a reason; none was given");
    }
    this.assertNoUnresolvedProcess();
    const run = this.store.getRun(runId);
    if (run.status !== "paused" && run.status !== "interrupted") {
      throw new RunStateError(
        `run ${runId} is ${run.status}; manual overrides apply only to a paused or interrupted run`,
      );
    }
    return run;
  }

  private requireConfigurationEdit(runId: string): RunRow {
    const run = this.store.getRun(runId);
    if (run.status !== "ready" && run.status !== "paused")
      throw new RunStateError(
        `run ${runId} is ${run.status}; configuration edits require a ready or paused run`,
      );
    if (this.store.activeAttempt(runId))
      throw new RunStateError(
        "configuration edits require no active attempt; settle or reconcile it first",
      );
    return run;
  }

  private advanceOnce(runId: string, allowEngineStep: boolean): AdvanceResult | "continue" {
    const run = this.store.getRun(runId);
    if (run.status !== "running" && run.status !== "pausing") {
      return { kind: "not_running", status: run.status };
    }
    const active = this.store.activeAttempt(runId);
    if (active) {
      return { kind: "in_progress", attemptId: active.attemptId, stepId: active.stepId };
    }
    if (run.status === "pausing") {
      this.pauseRun(run, USER_PAUSE_MESSAGE, "user_pause", null, "info");
      return { kind: "not_running", status: "paused" };
    }

    const taskOverrides = this.store.taskOverrides(run.activeTaskId);
    const compiled = this.taskWorkflow(run.revisionId, taskOverrides);
    const limitReason = this.exceededLimit(run, compiled);
    if (limitReason !== undefined) {
      this.pauseRun(run, limitReason.message, limitReason.category);
      return { kind: "not_running", status: "paused" };
    }

    const step = compiled.steps.get(run.cursorStepId);
    if (!step) {
      throw new RunStateError(
        `run ${runId} has cursor '${run.cursorStepId}', which the workflow does not declare`,
      );
    }
    if (!allowEngineStep && (step.kind === "task.next" || step.kind === "task.complete")) {
      this.pauseRun(
        run,
        `engine-only steps ran ${this.maxEngineSteps} times without an agent or command; the workflow may loop without doing work`,
        "engine_loop",
      );
      return { kind: "not_running", status: "paused" };
    }

    switch (step.kind) {
      case "end": {
        this.store.updateRun(runId, { status: "completed", endTime: this.now() });
        this.store.appendEvent({
          runId,
          revisionId: run.revisionId,
          type: "run_completed",
          data: { label: step.spec.kind === "end" ? (step.spec.label ?? null) : null },
        });
        return { kind: "completed" };
      }
      case "agent":
      case "command": {
        const skip = Object.hasOwn(taskOverrides.steps, step.id)
          ? taskOverrides.steps[step.id]?.skip
          : undefined;
        if (skip) {
          if (!allowEngineStep) {
            this.pauseRun(
              run,
              "configured skips exceeded the consecutive engine-step limit",
              "engine_loop",
            );
            return { kind: "not_running", status: "paused" };
          }
          this.store.appendEvent({
            runId,
            revisionId: run.revisionId,
            type: "step_skipped",
            data: { stepId: step.id, taskId: run.activeTaskId, outcome: skip.outcome },
          });
          this.commitRouting(
            run,
            step.id,
            skip.outcome,
            null,
            routeEngineStep(compiled, step.id, skip.outcome),
            `configured skip of '${step.id}'`,
          );
          return "continue";
        }
        const attempt = this.store.insertAttempt({
          taskOverrides,
          attemptId: this.newId("attempt"),
          runId,
          stepId: step.id,
          taskId: run.activeTaskId,
          revisionId: run.revisionId,
        });
        this.store.appendEvent({
          runId,
          attemptId: attempt.attemptId,
          revisionId: run.revisionId,
          type: "attempt_started",
          data: { stepId: step.id, kind: step.kind },
        });
        return {
          kind: "attempt",
          attemptId: attempt.attemptId,
          stepId: step.id,
          taskId: run.activeTaskId,
        };
      }
      case "task.next": {
        const selection = selectNextTask(this.store.listTasks(runId), run.activeTaskId);
        if (selection.outcome === "task_ready") {
          this.store.setTaskState(selection.taskId, "active");
          this.store.updateRun(runId, { activeTaskId: selection.taskId });
          this.store.appendEvent({
            runId,
            revisionId: run.revisionId,
            type: "task_activated",
            data: { taskId: selection.taskId },
          });
        }
        this.commitRouting(
          run,
          step.id,
          selection.outcome,
          null,
          routeEngineStep(compiled, step.id, selection.outcome),
          `step '${step.id}'`,
        );
        return "continue";
      }
      case "task.complete": {
        const selection = completeActiveTask(run.activeTaskId);
        if (selection.outcome === "complete") {
          this.store.setTaskState(selection.taskId, "completed");
          this.store.updateRun(runId, { activeTaskId: null });
          this.store.appendEvent({
            runId,
            revisionId: run.revisionId,
            type: "task_completed",
            data: { taskId: selection.taskId },
          });
        }
        this.commitRouting(
          run,
          step.id,
          selection.outcome,
          null,
          routeEngineStep(compiled, step.id, selection.outcome),
          `step '${step.id}'`,
        );
        return "continue";
      }
    }
  }

  /** Persists a routing decision, its transition row, its event, and any attention item. */
  private commitRouting(
    run: RunRow,
    fromStepId: string,
    outcome: string,
    attemptId: string | null,
    decision: Decision,
    subject: string,
  ): void {
    const toStepId = decision.kind === "pause" ? null : decision.stepId;
    this.store.insertTransition({
      runId: run.runId,
      revisionId: run.revisionId,
      attemptId,
      fromStepId,
      outcome: decision.via.outcome,
      actionJson: JSON.stringify(decision.via.action),
      toStepId,
    });
    this.store.appendEvent({
      runId: run.runId,
      attemptId,
      revisionId: run.revisionId,
      type: "transition_committed",
      data: {
        from: fromStepId,
        outcome: decision.via.outcome,
        decision: decision.kind,
        to: toStepId,
        reason: decision.kind === "pause" ? decision.reason : null,
      },
    });

    if (decision.kind === "goto") {
      this.store.updateRun(run.runId, { cursorStepId: decision.stepId });
    } else if (decision.kind === "pause") {
      this.pauseRun(
        run,
        pauseMessage(subject, outcome, decision.reason),
        decision.reason,
        attemptId,
      );
    }
    // A retry leaves the cursor on the same step, so the next advance starts a new attempt of it.
  }

  /**
   * Checks the workflow's limits before the next step starts (spec §3.1). Limits count committed
   * transitions and elapsed time since the run started. Reaching a limit pauses the run; it never
   * stops it silently.
   */
  private exceededLimit(
    run: RunRow,
    compiled: CompiledWorkflow,
  ): { readonly category: string; readonly message: string } | undefined {
    const { maxStepExecutions, maxWallTimeSeconds } = compiled.limits;
    if (
      maxStepExecutions !== undefined &&
      this.store.countTransitions(run.runId) >= maxStepExecutions
    ) {
      return {
        category: "limit_max_step_executions",
        message: `the run reached limits.max_step_executions (${maxStepExecutions}); the run is paused`,
      };
    }
    if (maxWallTimeSeconds !== undefined && run.startTime !== null) {
      const elapsed = (Date.parse(this.now()) - Date.parse(run.startTime)) / 1000;
      if (elapsed >= maxWallTimeSeconds) {
        return {
          category: "limit_max_wall_time",
          message: `the run reached limits.max_wall_time_seconds (${maxWallTimeSeconds}); the run is paused`,
        };
      }
    }
    return undefined;
  }

  private pauseRun(
    run: RunRow,
    message: string,
    category: string,
    attemptId: string | null = null,
    severity: AttentionSeverity = "blocking",
  ): void {
    this.store.updateRun(run.runId, { status: "paused" });
    this.store.appendEvent({
      runId: run.runId,
      attemptId,
      revisionId: run.revisionId,
      type: "run_paused",
      data: { reason: category },
    });
    this.store.insertAttention({ runId: run.runId, attemptId, category, severity, message });
    this.store.appendEvent({
      runId: run.runId,
      attemptId,
      revisionId: run.revisionId,
      type: "attention_raised",
      data: { category, severity },
    });
  }

  private compiledFor(revisionId: number): CompiledWorkflow {
    const revision = this.store.getRevision(revisionId);
    // SQLite can reuse an uncommitted revision id after rollback; cache immutable content instead.
    const key = JSON.stringify([revision.definitionSha256, revision.sourceDir]);
    const cached = this.compiledByRevision.get(key);
    if (cached) {
      return cached;
    }
    const checked = checkWorkflowText(revision.definitionYaml, { workflowDir: revision.sourceDir });
    if (!checked.compiled) {
      throw new WorkflowInvalidError(checked.diagnostics);
    }
    this.compiledByRevision.set(key, checked.compiled);
    return checked.compiled;
  }

  private taskWorkflow(revisionId: number, overrides: TaskOverrides): CompiledWorkflow {
    if (Object.keys(overrides.steps).length === 0) return this.compiledFor(revisionId);
    const revision = this.store.getRevision(revisionId);
    const parsed = parseWorkflowText(revision.definitionYaml);
    if (!parsed.document) throw new WorkflowInvalidError(parsed.diagnostics);
    const checked = compileWorkflow(specializeTask(parsed.document, overrides), {
      workflowDir: revision.sourceDir,
    });
    if (!checked.compiled) throw new WorkflowInvalidError(checked.diagnostics);
    return checked.compiled;
  }
}

function pauseMessage(subject: string, outcome: string, reason: string): string {
  switch (reason) {
    case "retry_exhausted":
      return `${subject} reached its retry limit on '${outcome}'; the run is paused`;
    case "retry_unsupported_for_engine_step":
      return `${subject} produced '${outcome}', and retry is not supported for engine-only steps; the run is paused`;
    default:
      return `${subject} produced '${outcome}', which the workflow routes to pause`;
  }
}
