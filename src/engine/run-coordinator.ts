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
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Diagnostic } from "../contracts/diagnostics.js";
import { hasErrors } from "../contracts/diagnostics.js";
import { isReservedName, isSystemOutcome, type SystemOutcome } from "../contracts/identifiers.js";
import {
  ACTIVE_ATTEMPT_STATUSES,
  type AttemptStatus,
  type AttentionSeverity,
  type RunStatus,
} from "../contracts/run-state.js";
import type { WorkflowDatabase } from "../store/database.js";
import {
  type AttemptRow,
  type NewTask,
  type RunRow,
  RunStore,
  type TaskRow,
} from "../store/run-store.js";
import { checkWorkflowText } from "./check.js";
import type { CompiledWorkflow } from "./model.js";
import {
  completeActiveTask,
  type Decision,
  routeAttempt,
  routeEngineStep,
  selectNextTask,
} from "./reducer.js";

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
    const tasks = input.tasks ?? [];
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
      const compiled = this.compiledFor(run.revisionId);
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

  /**
   * Startup reconciliation (todo 7.1 will refine it). An attempt still marked active after a restart
   * may or may not have finished its side effects, so it is never replayed. The attempt is marked
   * interrupted, the run is marked interrupted, and a blocking attention item asks the user to decide.
   */
  reconcileAfterRestart(runId: string): boolean {
    return this.database.transaction(() => {
      const run = this.store.getRun(runId);
      if (run.status !== "running" && run.status !== "pausing") {
        return false;
      }
      const active = this.store.activeAttempt(runId);
      if (!active) {
        return false;
      }
      this.store.setAttemptStatus(active.attemptId, "interrupted", {
        errorCode: "uncertain_after_restart",
      });
      this.store.updateRun(runId, { status: "interrupted" });
      this.store.appendEvent({
        runId,
        attemptId: active.attemptId,
        revisionId: run.revisionId,
        type: "run_interrupted",
        data: { stepId: active.stepId },
      });
      this.store.insertAttention({
        runId,
        attemptId: active.attemptId,
        category: "uncertain_attempt",
        severity: "blocking",
        message: `step '${active.stepId}' was running when the runner stopped, so its result is unknown. Check its log before resuming; resuming runs the step again.`,
      });
      return true;
    });
  }

  /** Manual override: move the cursor to a declared step. Requires a paused or interrupted run and a reason. */
  jumpTo(runId: string, stepId: string, reason: string): void {
    this.database.transaction(() => {
      const run = this.requireManualEdit(runId, reason);
      const compiled = this.compiledFor(run.revisionId);
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
      const compiled = this.compiledFor(run.revisionId);
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
    activeAttempt: AttemptRow | undefined;
    attempts: AttemptRow[];
    transitions: ReturnType<RunStore["listTransitions"]>;
    events: ReturnType<RunStore["listEvents"]>;
    attention: ReturnType<RunStore["listAttention"]>;
  } {
    return this.database.transaction(() => ({
      run: this.store.getRun(runId),
      tasks: this.store.listTasks(runId),
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
    const run = this.store.getRun(runId);
    if (run.status !== "paused" && run.status !== "interrupted") {
      throw new RunStateError(
        `run ${runId} is ${run.status}; manual overrides apply only to a paused or interrupted run`,
      );
    }
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

    const compiled = this.compiledFor(run.revisionId);
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
        const attempt = this.store.insertAttempt({
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
