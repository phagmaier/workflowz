/**
 * The run coordinator: the only code that changes a run's persisted state (architecture §2.1).
 *
 * Each step has the same shape. Read the run, decide with the pure reducer, then write the
 * decision together with its event, all in one transaction. A failed write therefore leaves
 * nothing half-applied. Settlement is rejected before any write when the outcome is not declared,
 * so a bad report never changes state (spec §4.2).
 *
 * This module does not start processes. An agent or command attempt is handed to the caller as
 * `attempt`, and the caller reports back with `settle`. Process ownership arrives in phase 3.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Diagnostic } from "../contracts/diagnostics.js";
import { hasErrors } from "../contracts/diagnostics.js";
import { isReservedName, isSystemOutcome, type SystemOutcome } from "../contracts/identifiers.js";
import type { AttemptStatus, RunStatus } from "../contracts/run-state.js";
import { ACTIVE_ATTEMPT_STATUSES } from "../contracts/run-state.js";
import type { WorkflowDatabase } from "../store/database.js";
import { type AttemptRow, type NewTask, type RunRow, RunStore } from "../store/run-store.js";
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
  | { readonly kind: "system"; readonly code: SystemOutcome };

export interface SettleResult {
  readonly outcome: string;
  readonly decision: Decision;
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
  private readonly compiledByRevision = new Map<number, CompiledWorkflow>();
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
    const tasks = input.tasks ?? [];
    if (tasks.length > 0 && checked.compiled.tasksSourcePath === undefined) {
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
        projectRoot: checked.compiled?.projectRoot ?? sourceDir,
        startStepId: checked.compiled?.start ?? "",
        tasks,
      });
      this.compiledByRevision.set(revisionId, checked.compiled as CompiledWorkflow);
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
      this.store.updateRun(runId, { status: "running", startTime: this.now() });
      this.store.appendEvent({ runId, revisionId: run.revisionId, type: "run_started" });
    });
  }

  /**
   * Runs engine-only steps in place until the cursor reaches an agent or command step (which
   * becomes an attempt), the run finishes, or the run stops. Only one attempt may be active at a
   * time, so an active attempt is returned as `in_progress` without starting another.
   */
  advance(runId: string): AdvanceResult {
    for (let steps = 0; steps < this.maxEngineSteps; steps += 1) {
      const result = this.database.transaction(() => this.advanceOnce(runId));
      if (result !== "continue") {
        return result;
      }
    }
    this.database.transaction(() => {
      const run = this.store.getRun(runId);
      this.pauseRun(
        run,
        `engine-only steps ran more than ${this.maxEngineSteps} times without an agent or command; the workflow may loop without doing work`,
        "engine_loop",
      );
    });
    return { kind: "not_running", status: "paused" };
  }

  /**
   * Records what happened to an attempt and routes it. Exactly one transition is committed per
   * attempt. A second settlement, or one for an attempt that already settled, is refused.
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
      if (run.status !== "running") {
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
        if (isSystemOutcome(outcome) || isReservedName(outcome)) {
          throw new UndeclaredOutcomeError(outcome, step.id, step.outcomes);
        }
        if (!step.outcomes.includes(outcome)) {
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
        data: { outcome, status: finalStatus },
      });
      this.commitRouting(run, step.id, outcome, attemptId, decision, `attempt ${attemptId}`);
      return { outcome, decision };
    });
  }

  /** Read-only view of a run's persisted state, for inspection and tests. */
  inspect(runId: string): {
    run: RunRow;
    tasks: ReturnType<RunStore["listTasks"]>;
    activeAttempt: AttemptRow | undefined;
    transitions: ReturnType<RunStore["listTransitions"]>;
    events: ReturnType<RunStore["listEvents"]>;
    attention: ReturnType<RunStore["listAttention"]>;
  } {
    return this.database.transaction(() => ({
      run: this.store.getRun(runId),
      tasks: this.store.listTasks(runId),
      activeAttempt: this.store.activeAttempt(runId),
      transitions: this.store.listTransitions(runId),
      events: this.store.listEvents(runId),
      attention: this.store.listAttention(runId),
    }));
  }

  private advanceOnce(runId: string): AdvanceResult | "continue" {
    const run = this.store.getRun(runId);
    if (run.status !== "running") {
      return { kind: "not_running", status: run.status };
    }
    const active = this.store.activeAttempt(runId);
    if (active) {
      return { kind: "in_progress", attemptId: active.attemptId, stepId: active.stepId };
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
        const attemptId = this.newId("attempt");
        const attempt = this.store.insertAttempt({
          attemptId,
          runId,
          stepId: step.id,
          taskId: run.activeTaskId,
          revisionId: run.revisionId,
        });
        this.store.appendEvent({
          runId,
          attemptId,
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
      outcome,
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
        outcome,
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
  ): void {
    this.store.updateRun(run.runId, { status: "paused" });
    this.store.appendEvent({
      runId: run.runId,
      attemptId,
      revisionId: run.revisionId,
      type: "run_paused",
      data: { reason: category },
    });
    this.store.insertAttention({
      runId: run.runId,
      attemptId,
      category,
      severity: "blocking",
      message,
    });
    this.store.appendEvent({
      runId: run.runId,
      attemptId,
      revisionId: run.revisionId,
      type: "attention_raised",
      data: { category },
    });
  }

  private compiledFor(revisionId: number): CompiledWorkflow {
    const cached = this.compiledByRevision.get(revisionId);
    if (cached) {
      return cached;
    }
    const revision = this.store.getRevision(revisionId);
    const checked = checkWorkflowText(revision.definitionYaml, { workflowDir: revision.sourceDir });
    if (!checked.compiled) {
      throw new WorkflowInvalidError(checked.diagnostics);
    }
    this.compiledByRevision.set(revisionId, checked.compiled);
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
