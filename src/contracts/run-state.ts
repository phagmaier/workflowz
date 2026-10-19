/**
 * Persisted run, attempt, task, and event vocabulary (architecture §2, spec §6). These are the only
 * state names the store may write; the database enforces the same sets with CHECK constraints.
 */
export const RUN_STATUSES = [
  "draft",
  "ready",
  "running",
  "pausing",
  "paused",
  "completed",
  "stopped",
  "interrupted",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const ATTEMPT_STATUSES = [
  "created",
  "starting",
  "running",
  "settling",
  "succeeded",
  "failed",
  "interrupted",
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/** Attempts in these states occupy the single global execution slot (spec §6, architecture §7.1). */
export const ACTIVE_ATTEMPT_STATUSES: readonly AttemptStatus[] = [
  "created",
  "starting",
  "running",
  "settling",
];

export const TASK_STATES = ["pending", "active", "completed"] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const ATTENTION_SEVERITIES = ["info", "warning", "blocking"] as const;
export type AttentionSeverity = (typeof ATTENTION_SEVERITIES)[number];

export const EVENT_TYPES = [
  "run_created",
  "run_started",
  "run_completed",
  "run_paused",
  "run_resumed",
  "run_stopped",
  "run_interrupted",
  "pause_requested",
  "manual_override",
  "attempt_started",
  "attempt_prepared",
  "attempt_settled",
  "report_accepted",
  "correction_requested",
  "invocation_dispatching",
  "process_reconciled",
  "recovery_cleanup_confirmed",
  "recovery_termination_requested",
  "recovery_termination_finished",
  "recovery_decided",
  "invocation_started",
  "invocation_settled",
  "tasks_imported",
  "task_overrides_changed",
  "workflow_revised",
  "step_skipped",
  "task_activated",
  "task_completed",
  "transition_committed",
  "attention_raised",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
