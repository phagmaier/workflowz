/**
 * Pure routing and task-selection decisions (architecture §2.1, spec §3.2–3.3).
 *
 * Nothing in this file reads a database, spawns a process, or consults the clock. Given a compiled
 * workflow and a settled outcome, it says where the run goes next. The coordinator persists that
 * decision, so the same inputs always produce the same routing.
 */
import type { TaskState } from "../contracts/run-state.js";
import type { CompiledWorkflow, ResolvedTransition } from "./model.js";
import { resolveOutcome } from "./routing.js";

export type Decision =
  | { readonly kind: "goto"; readonly stepId: string; readonly via: ResolvedTransition }
  | { readonly kind: "retry"; readonly stepId: string; readonly via: ResolvedTransition }
  | {
      readonly kind: "pause";
      readonly outcome: string;
      readonly reason: PauseReason;
      readonly via: ResolvedTransition;
    };

/**
 * Why a run paused. Each reason produces a different attention item, so the user can tell a
 * deliberate workflow pause from a retry budget running out.
 */
export type PauseReason = "routed" | "retry_exhausted" | "retry_unsupported_for_engine_step";

/**
 * Routes a settled attempt's outcome.
 *
 * `attemptsSoFar` counts every attempt of this step within the current task, including the one that
 * just settled. A `retry` action reruns the step until that count reaches `max_attempts`. Then
 * `system.retry_exhausted` routes instead. If that also asks for a retry, the run pauses, so a
 * retry can never loop back into itself.
 */
export function routeAttempt(
  workflow: CompiledWorkflow,
  stepId: string,
  outcome: string,
  attemptsSoFar: number,
): Decision {
  const declared = new Set(workflow.steps.get(stepId)?.outcomes ?? []);
  const via = resolveOutcome(workflow, stepId, outcome, declared);
  if (via.action.kind === "goto") {
    return { kind: "goto", stepId: via.action.target, via };
  }
  if (via.action.kind === "pause") {
    return { kind: "pause", outcome, reason: "routed", via };
  }
  if (attemptsSoFar < via.action.maxAttempts) {
    return { kind: "retry", stepId, via };
  }
  return routeRetryExhausted(workflow, stepId, outcome);
}

/**
 * Routes an engine-only step (`task.next`, `task.complete`). These have no attempt to rerun, so a
 * retry action is treated as a pause and the attention item names the cause.
 */
export function routeEngineStep(
  workflow: CompiledWorkflow,
  stepId: string,
  outcome: string,
): Decision {
  const declared = new Set(workflow.steps.get(stepId)?.outcomes ?? []);
  const via = resolveOutcome(workflow, stepId, outcome, declared);
  if (via.action.kind === "goto") {
    return { kind: "goto", stepId: via.action.target, via };
  }
  if (via.action.kind === "retry") {
    return { kind: "pause", outcome, reason: "retry_unsupported_for_engine_step", via };
  }
  return { kind: "pause", outcome, reason: "routed", via };
}

function routeRetryExhausted(
  workflow: CompiledWorkflow,
  stepId: string,
  outcome: string,
): Decision {
  const exhausted = "system.retry_exhausted";
  const declared = new Set<string>();
  const via = resolveOutcome(workflow, stepId, exhausted, declared);
  if (via.action.kind === "goto") {
    return { kind: "goto", stepId: via.action.target, via };
  }
  return { kind: "pause", outcome, reason: "retry_exhausted", via };
}

export interface TaskSnapshot {
  readonly taskId: string;
  readonly sourceOrder: number;
  readonly state: TaskState;
}

export type TaskSelection =
  | { readonly outcome: "task_ready"; readonly taskId: string }
  | { readonly outcome: "exhausted" }
  | { readonly outcome: "system.task_state_error" };

/**
 * `task.next` (spec §3.2): picks the first unfinished task in source order. A task that is still
 * active is never skipped silently, so that case is a state error.
 */
export function selectNextTask(
  tasks: readonly TaskSnapshot[],
  activeTaskId: string | null,
): TaskSelection {
  if (activeTaskId !== null) {
    return { outcome: "system.task_state_error" };
  }
  const next = [...tasks]
    .filter((task) => task.state === "pending")
    .sort((a, b) => a.sourceOrder - b.sourceOrder)[0];
  return next ? { outcome: "task_ready", taskId: next.taskId } : { outcome: "exhausted" };
}

/** `task.complete` (spec §3.2): requires an active task; otherwise it is a state error. */
export function completeActiveTask(
  activeTaskId: string | null,
):
  | { readonly outcome: "complete"; readonly taskId: string }
  | { readonly outcome: "system.task_state_error" } {
  return activeTaskId === null
    ? { outcome: "system.task_state_error" }
    : { outcome: "complete", taskId: activeTaskId };
}
