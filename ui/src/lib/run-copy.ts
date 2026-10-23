/** Plain-language status headline for a run, derived from its status and readable history. */
import type { BrowserRunStatus, RunStatus } from "../types.ts";
import { technicalFailure } from "./failure.ts";
import { duration, harnessLabel, humanize, sentence } from "./format.ts";
import type { HistoryItem, StepItem } from "./history.ts";

export type Tone = "neutral" | "active" | "attention" | "success" | "danger";
export const STATUS: Record<RunStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  ready: { label: "Ready", tone: "neutral" },
  running: { label: "Running", tone: "active" },
  pausing: { label: "Pausing", tone: "attention" },
  paused: { label: "Paused", tone: "attention" },
  completed: { label: "Completed", tone: "success" },
  stopped: { label: "Stopped", tone: "neutral" },
  interrupted: { label: "Interrupted", tone: "danger" },
};
/** Where a run was when a control was sent: its status, current step and latest event. */
export interface RunPlace {
  status: RunStatus;
  cursor: string;
  eventId: number;
}

const APPLY_CONTROLS = new Set(["skip", "jump", "complete-task"]);

/** A control's success message describes the step and state it acted on. Once the run has
 * moved on, the heading and history say what happened instead. */
export function feedbackCurrent(control: string, sent: RunPlace, now: RunPlace) {
  if (now.status === "completed" || now.status === "stopped") return true;
  // The read from before the control took effect.
  if (now.eventId === sent.eventId) return true;
  // Apply keeps the run paused, even when it moves the next step. A later pause after
  // Resume or Start is a new situation, even at the same step.
  if (APPLY_CONTROLS.has(control)) return now.status === "paused";
  return now.cursor === sent.cursor && (now.status === "running" || now.status === "pausing");
}
export const needsAttention = (status: RunStatus) =>
  status === "paused" || status === "interrupted";

export type RunGroupId = "waiting" | "ready" | "running" | "finished";

/** Sidebar and Runs grouping: every status belongs to exactly one group. */
export const RUN_GROUPS: readonly {
  id: RunGroupId;
  label: string;
  description: string;
  empty: string;
  statuses: readonly RunStatus[];
}[] = [
  {
    id: "waiting",
    label: "Waiting for you",
    description: "Paused runs and interrupted work that need your decision.",
    empty: "Nothing is waiting for you.",
    statuses: ["paused", "interrupted"],
  },
  {
    id: "ready",
    label: "Ready to start",
    description: "Prepared runs. Open one to review it and choose Start.",
    empty: "No runs are ready to start.",
    statuses: ["draft", "ready"],
  },
  {
    id: "running",
    label: "Running",
    description: "Work in progress. Runs keep going if you close this browser.",
    empty: "No runs are running.",
    statuses: ["running", "pausing"],
  },
  {
    id: "finished",
    label: "Finished",
    description: "Completed and stopped runs. Open one to see what happened.",
    empty: "No finished runs yet.",
    statuses: ["completed", "stopped"],
  },
];

const quote = (text: string) => `“${text}”`;

export function taskPosition(status: BrowserRunStatus): string | null {
  const { tasks, run } = status;
  const index = tasks.findIndex((task) => task.taskId === run.activeTaskId);
  return index < 0 ? null : `task ${index + 1} of ${tasks.length}`;
}

/** The task loop's position, kept apart from whether the run itself has finished. */
export function taskPhase(status: BrowserRunStatus): { label: string; note: string | null } {
  const { run, progress, tasks } = status;
  const index = tasks.findIndex((task) => task.taskId === run.activeTaskId);
  const task = tasks[index];
  if (task) return { label: `${index + 1} of ${tasks.length} · ${task.title}`, note: null };
  if (!progress) return { label: "No task list", note: null };
  if (progress.total === 0) return { label: "No tasks imported", note: null };
  const finished = run.status === "completed" || run.status === "stopped";
  if (progress.completed === progress.total)
    return {
      label: `All ${progress.total} done`,
      note: finished ? null : "Run not finished yet",
    };
  if (!finished && tasks.every((t) => t.state === "pending"))
    return { label: "None started yet", note: null };
  return { label: `${progress.completed} of ${progress.total} done · none active`, note: null };
}

/**
 * The attempt's latest recorded stage. Workflowz sees only its own events, never what the
 * agent or command is doing between them.
 */
export function attemptActivity(item: StepItem, kind: string | undefined): string {
  const running =
    kind === "agent" ? "Agent running" : kind === "command" ? "Command running" : "Running";
  const correcting = "Asking the agent for its missing report";
  let stage = "Preparing";
  for (const event of item.events)
    switch (event.type) {
      case "invocation_dispatching":
        stage = event.data.invocation === 1 ? correcting : `Starting the ${kind ?? "step"}`;
        break;
      case "invocation_started":
        stage = event.data.invocation === 1 ? correcting : running;
        break;
      case "correction_requested":
        stage = correcting;
        break;
      case "report_accepted":
        stage = "Report received; waiting for the agent to exit";
        break;
      case "invocation_settled":
        stage = "Process finished; recording the result";
        break;
    }
  return stage;
}

/** The read's own clock: the run's end, or when the daemon answered the status read. */
export function statusTime(status: BrowserRunStatus): string | null {
  const { startTime, endTime } = status.run;
  if (endTime) return endTime;
  return startTime ? new Date(Date.parse(startTime) + status.elapsedMs).toISOString() : null;
}

/** Time between recorded pauses and the resume or stop that ended them, up to `end`. */
export function pausedMs(items: readonly HistoryItem[], end: string | null): number {
  let total = 0;
  let since: number | null = null;
  for (const item of items) {
    if (item.type !== "note") continue;
    if (item.kind === "paused") since ??= Date.parse(item.at);
    else if ((item.kind === "resumed" || item.kind === "stopped") && since !== null) {
      total += Date.parse(item.at) - since;
      since = null;
    }
  }
  if (since !== null && end) total += Date.parse(end) - since;
  return Number.isFinite(total) ? Math.max(0, total) : 0;
}

export function describeRun(
  status: BrowserRunStatus,
  items: readonly HistoryItem[],
  now = Date.now(),
): { headline: string; detail: string } {
  const { run, current } = status;
  const step = humanize(run.cursorStepId);
  const position = taskPosition(status);
  const keepsGoing = "It keeps going if you close this browser.";
  const lastStep = [...items].reverse().find((item): item is StepItem => item.type === "step");
  const lastPause = [...items]
    .reverse()
    .find((item) => item.type === "note" && item.kind === "paused");
  switch (run.status) {
    case "draft":
    case "ready": {
      const tasks = status.tasks.length;
      return {
        headline: "Ready to start",
        detail: `Nothing has run yet. Start runs ${step} first${
          status.progress
            ? ` and works through ${tasks} imported task${tasks === 1 ? "" : "s"}`
            : ""
        }. ${keepsGoing}`,
      };
    }
    case "running": {
      if (run.retryNotBefore && Date.parse(run.retryNotBefore) > now)
        return {
          headline: `Running — waiting to retry ${step}`,
          detail: `${step} will be tried again after ${new Date(run.retryNotBefore).toLocaleTimeString()}. ${keepsGoing}`,
        };
      const who =
        current?.kind === "agent"
          ? `${harnessLabel(current.harness ?? "")}${current.model ? ` (${current.model})` : ""} is working on this step.`
          : current?.kind === "command"
            ? "A command is running in the project folder."
            : "Moving to the next step.";
      const progress = status.progress;
      const tasksDone =
        progress && progress.total > 0 && progress.completed === progress.total && !position
          ? ` ${progress.total === 1 ? "The imported task is" : `All ${progress.total} imported tasks are`} done; the workflow continues with ${step}.`
          : "";
      return {
        headline: `Running — ${step}${position ? `, ${position}` : ""}`,
        detail: `${who}${tasksDone} ${keepsGoing}`,
      };
    }
    case "pausing":
      return {
        headline: `Pausing after ${step} finishes`,
        detail:
          "The current step keeps running. When it finishes, its result is recorded and the run pauses instead of moving on.",
      };
    case "paused": {
      // A manual change after the pause means the user has already acted on it.
      const pauseIndex = lastPause ? items.indexOf(lastPause) : -1;
      const changed = items
        .slice(pauseIndex + 1)
        .some(
          (item) =>
            (item.type === "note" && (item.kind === "manual" || item.kind === "revised")) ||
            (item.type === "step" && item.byYou),
        );
      if (changed)
        return {
          headline: `Paused — next step is ${step}`,
          detail:
            "Your change is recorded. Resume when you're ready; the run continues from the step shown.",
        };
      if (lastPause?.type === "note" && lastPause.text !== "Paused")
        return {
          headline: lastPause.text,
          detail: `Next step is ${step}. Resume when you're ready.`,
        };
      if (lastStep?.decision === "pause" && lastStep.outcome) {
        const name = humanize(lastStep.stepId);
        const failure = technicalFailure(
          lastStep,
          current?.kind === "agent" ? current.harness : undefined,
        );
        if (failure)
          return {
            headline: `Paused — ${name} had a technical failure`,
            detail: `${name} ended with a technical failure. ${failure.cause} Choose what happens next.`,
          };
        const summary = lastStep.report?.summary;
        const why =
          lastStep.pauseReason === "retry_exhausted"
            ? `${name} used up its retries after ${quote(lastStep.outcome)}.`
            : `${name} ${lastStep.report ? "reported" : "finished with"} ${quote(lastStep.outcome)}${summary ? `: ${sentence(summary)}` : "."}`;
        return {
          headline: `Paused — ${name} needs your decision`,
          detail: `${why} Choose what happens next.`,
        };
      }
      return { headline: `Paused — next step is ${step}`, detail: "Resume when you're ready." };
    }
    case "completed": {
      const finished = [...items]
        .reverse()
        .find((item) => item.type === "note" && item.kind === "completed");
      const tasks = status.progress
        ? ` ${status.progress.completed} of ${status.progress.total} tasks done.`
        : "";
      const paused = pausedMs(items, statusTime(status));
      return {
        headline:
          finished?.type === "note" && finished.text.startsWith("Finished: ")
            ? `Completed — ${finished.text.slice("Finished: ".length)}`
            : "Completed",
        detail: `Finished in ${duration(status.elapsedMs)}${paused ? `, including ${duration(paused)} paused` : ""}.${tasks}`,
      };
    }
    case "stopped": {
      const stopped = [...items]
        .reverse()
        .find((item) => item.type === "note" && item.kind === "stopped");
      const reason = stopped?.type === "note" ? stopped.reason : null;
      return {
        headline: "Stopped",
        detail: `Stopped${reason ? `: ${quote(reason)}` : ""}. Changes already made to files were not rolled back. A stopped run can't be resumed.`,
      };
    }
    case "interrupted":
      return {
        headline: "Interrupted — needs a recovery decision",
        detail: `The daemon stopped while ${step} was active. Workflowz never reruns uncertain work on its own; decide what happens next from the terminal.`,
      };
  }
}
