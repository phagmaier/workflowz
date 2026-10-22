/**
 * Turns the run's append-only event log into readable history: one item per step execution or
 * notable run event, grouped into consecutive task segments. Pure; the events stay authoritative.
 */
import type { EventRow, ReportRow } from "../types.ts";
import { humanize } from "./format.ts";

export type StepState = "running" | "done" | "interrupted" | "stopped" | "skipped";
export type NoteKind =
  | "created"
  | "started"
  | "pause_requested"
  | "paused"
  | "resumed"
  | "stopped"
  | "interrupted"
  | "completed"
  | "manual"
  | "revised"
  | "recovery";

interface Base {
  id: string;
  taskId: string | null;
  at: string;
  events: EventRow[];
}
export interface StepItem extends Base {
  type: "step";
  stepId: string;
  attemptId: string | null;
  state: StepState;
  /** True when you chose this result yourself (manual skip). */
  byYou: boolean;
  endedAt: string | null;
  outcome: string | null;
  decision: "goto" | "pause" | "retry" | null;
  to: string | null;
  pauseReason: string | null;
  report: ReportRow | null;
  harnessVersion: string | null;
  permissionMode: string | null;
  exitCode: number | null;
  timedOut: boolean;
  stderr: string | null;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  failureDetail: string | null;
}
export interface NoteItem extends Base {
  type: "note";
  kind: NoteKind;
  text: string;
  reason: string | null;
}
export type HistoryItem = StepItem | NoteItem;
export interface HistoryGroup {
  key: string;
  taskId: string | null;
  items: HistoryItem[];
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

function pausedText(category: string | null): string {
  switch (category) {
    case "user_pause":
      return "Paused at your request";
    case "limit_max_step_executions":
      return "Paused: the workflow's step limit was reached";
    case "limit_max_wall_time":
      return "Paused: the workflow's time limit was reached";
    default:
      return "Paused";
  }
}

export function buildHistory(events: readonly EventRow[], reports: readonly ReportRow[]) {
  const reportByAttempt = new Map(reports.map((report) => [report.attemptId, report]));
  const items: HistoryItem[] = [];
  const attempts = new Map<string, StepItem>();
  let task: string | null = null;
  let closeTaskAfterTransition = false;
  // A skipped step's routing arrives as a following transition without an attempt.
  let pendingSkip: StepItem | null = null;
  // Held in an object: TypeScript does not track assignments made inside the helper closure.
  const latest: { note: NoteItem | null } = { note: null };
  const carried: EventRow[] = [];

  const note = (event: EventRow, kind: NoteKind, label: string, reason: string | null = null) => {
    const item: NoteItem = {
      type: "note",
      id: `e${event.eventId}`,
      taskId: task,
      at: event.timestamp,
      events: [event],
      kind,
      text: label,
      reason,
    };
    items.push(item);
    latest.note = item;
    return item;
  };
  const step = (event: EventRow, stepId: string, attemptId: string | null, state: StepState) => {
    const item: StepItem = {
      type: "step",
      id: attemptId ? `a${attemptId}` : `e${event.eventId}`,
      taskId: task,
      at: event.timestamp,
      events: [event],
      stepId,
      attemptId,
      state,
      byYou: false,
      endedAt: state === "running" ? null : event.timestamp,
      outcome: null,
      decision: null,
      to: null,
      pauseReason: null,
      report: attemptId ? (reportByAttempt.get(attemptId) ?? null) : null,
      harnessVersion: null,
      permissionMode: null,
      exitCode: null,
      timedOut: false,
      stderr: null,
      stdoutTruncated: false,
      stderrTruncated: false,
      failureDetail: null,
    };
    items.push(item);
    if (attemptId) attempts.set(attemptId, item);
    return item;
  };

  for (const event of events) {
    const data = event.data;
    const owner = event.attemptId ? attempts.get(event.attemptId) : undefined;
    switch (event.type) {
      case "run_created":
        note(event, "created", "Run created");
        break;
      case "tasks_imported": {
        const total = typeof data.runnable === "number" ? data.runnable : 0;
        const label = `Run created with ${total} task${total === 1 ? "" : "s"} to do`;
        const created = latest.note?.kind === "created" ? latest.note : null;
        if (created) {
          created.text = label;
          created.events.push(event);
        } else note(event, "created", label);
        break;
      }
      case "run_started":
        note(event, "started", "Started");
        break;
      case "pause_requested":
        note(event, "pause_requested", "You asked to pause after the current step");
        break;
      case "run_paused":
        note(event, "paused", pausedText(text(data.reason)));
        break;
      case "run_resumed":
        note(event, "resumed", "Resumed", text(data.note));
        break;
      case "run_stopped":
        note(event, "stopped", "Stopped", text(data.reason));
        break;
      case "run_completed": {
        const label = text(data.label);
        note(event, "completed", label ? `Finished: ${label}` : "Finished");
        break;
      }
      case "run_interrupted":
        if (owner && owner.state === "running") {
          owner.state = "interrupted";
          owner.events.push(event);
        }
        note(event, "interrupted", "Interrupted: the daemon stopped while this run was active");
        break;
      case "workflow_revised":
        note(
          event,
          "revised",
          `Workflow changed for this run (revision ${String(data.revisionId)})`,
          text(data.reason),
        );
        break;
      case "recovery_decided":
        note(event, "recovery", `Recovery decision: ${String(data.action)}`, text(data.reason));
        break;
      case "manual_override": {
        const reason = text(data.reason);
        if (data.action === "skip") {
          const item = step(event, String(data.stepId), null, "skipped");
          item.byYou = true;
          item.outcome = text(data.outcome);
          pendingSkip = item;
        } else if (data.action === "jump")
          note(event, "manual", `You moved the run to ${humanize(String(data.to))}`, reason);
        else note(event, "manual", "You marked a task done", reason);
        break;
      }
      case "step_skipped": {
        const item = step(event, String(data.stepId), null, "skipped");
        item.outcome = text(data.outcome);
        pendingSkip = item;
        break;
      }
      case "task_activated":
        // Shown with the step that picked the task, which follows immediately.
        task = text(data.taskId);
        carried.push(event);
        break;
      case "task_completed":
        (latest.note ?? items.at(-1))?.events.push(event);
        if (data.manual === true) {
          if (data.taskId === task) task = null;
        } else closeTaskAfterTransition = true;
        break;
      case "attempt_started":
        step(event, String(data.stepId), event.attemptId, "running");
        break;
      case "invocation_started":
        if (owner) {
          owner.events.push(event);
          owner.harnessVersion = text(data.harnessVersion) ?? owner.harnessVersion;
          owner.permissionMode = text(data.permissionMode) ?? owner.permissionMode;
        }
        break;
      case "invocation_settled":
        if (owner) {
          owner.events.push(event);
          owner.exitCode = typeof data.exitCode === "number" ? data.exitCode : null;
          owner.timedOut = data.timedOut === true;
          const diagnostics = data.diagnostics as
            | { stderr?: unknown; stdoutTruncated?: unknown; stderrTruncated?: unknown }
            | undefined;
          const stderr = text(diagnostics?.stderr);
          owner.stderr = stderr?.trim() ? stderr : null;
          owner.stdoutTruncated = diagnostics?.stdoutTruncated === true;
          owner.stderrTruncated = diagnostics?.stderrTruncated === true;
        }
        break;
      case "attempt_settled":
        if (owner) {
          owner.events.push(event);
          owner.endedAt = event.timestamp;
          if (data.status === "interrupted") owner.state = "stopped";
          else if (owner.state === "running") owner.state = "done";
          owner.outcome = text(data.outcome) ?? owner.outcome;
          owner.failureDetail = text(data.detail) ?? owner.failureDetail;
        }
        break;
      case "transition_committed": {
        let item: StepItem | null = owner ?? null;
        if (!item && pendingSkip?.stepId === data.from) item = pendingSkip;
        if (!item) item = step(event, String(data.from), null, "done");
        else item.events.push(event);
        item.events.unshift(...carried.splice(0));
        if (item === pendingSkip) pendingSkip = null;
        item.outcome = text(data.outcome) ?? item.outcome;
        item.decision =
          data.decision === "goto" || data.decision === "pause" || data.decision === "retry"
            ? data.decision
            : null;
        item.to = text(data.to);
        item.pauseReason = text(data.reason);
        if (closeTaskAfterTransition) {
          closeTaskAfterTransition = false;
          task = null;
        }
        break;
      }
      case "attention_raised":
        (latest.note ?? items.at(-1))?.events.push(event);
        break;
      default:
        // Preparation, dispatch, correction and process evidence belong to their attempt.
        if (owner) owner.events.push(event);
        else if (event.type.startsWith("recovery_") || event.type === "process_reconciled")
          note(event, "recovery", humanizeEvent(event.type));
        else (latest.note ?? items.at(-1))?.events.push(event);
    }
  }
  return items;
}

function humanizeEvent(type: string): string {
  const words = type.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Consecutive items for the same task form one segment, so loops read in order. */
export function groupHistory(items: readonly HistoryItem[]): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.taskId === item.taskId) last.items.push(item);
    else
      groups.push({
        key: `${groups.length}:${item.taskId ?? "run"}`,
        taskId: item.taskId,
        items: [item],
      });
  }
  return groups;
}

export const stepItems = (items: readonly HistoryItem[]) =>
  items.filter((item): item is StepItem => item.type === "step");

/** How many times each step ran and which routes were taken, for the run map. */
export function walked(items: readonly HistoryItem[]) {
  const counts = new Map<string, number>();
  const edges = new Map<string, number>();
  for (const item of stepItems(items)) {
    // A skipped step did not run, but the route it took is still part of the path.
    if (item.state !== "skipped") counts.set(item.stepId, (counts.get(item.stepId) ?? 0) + 1);
    if (item.decision === "goto" && item.to && item.outcome) {
      const key = edgeKey(item.stepId, item.outcome, item.to);
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return { counts, edges };
}

/** System outcomes share one map edge per destination. */
export const edgeKey = (from: string, outcome: string, to: string) =>
  `${from}|${outcome.startsWith("system.") ? "system" : outcome}|${to}`;

const PRIVATE_KEYS = new Set(["logPath"]);
// Attempt logs and file-backed sessions live under the daemon's private state directory.
const PRIVATE_PATH = /^\/.*\/logs\//;
const HIDDEN = "(private path, not shown)";
/** Raw event data without private runtime locations such as per-attempt log files. */
export function redact(value: unknown): unknown {
  if (typeof value === "string") return PRIVATE_PATH.test(value) ? HIDDEN : value;
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        PRIVATE_KEYS.has(key) && entry !== null ? HIDDEN : redact(entry),
      ]),
    );
  return value;
}
