/** Plain-language status headline for a run, derived from its status and readable history. */
import type { BrowserRunStatus, RunStatus } from "../types.ts";
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
export const needsAttention = (status: RunStatus) =>
  status === "paused" || status === "interrupted";

/** Sidebar and Runs grouping: every status belongs to exactly one group. */
export const RUN_GROUPS: readonly { label: string; statuses: readonly RunStatus[] }[] = [
  { label: "Waiting for you", statuses: ["paused", "interrupted"] },
  { label: "Ready to start", statuses: ["draft", "ready"] },
  { label: "Running", statuses: ["running", "pausing"] },
  { label: "Finished", statuses: ["completed", "stopped"] },
];

const quote = (text: string) => `“${text}”`;

export function taskPosition(status: BrowserRunStatus): string | null {
  const { tasks, run } = status;
  const index = tasks.findIndex((task) => task.taskId === run.activeTaskId);
  return index < 0 ? null : `task ${index + 1} of ${tasks.length}`;
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
      return {
        headline: `Running — ${step}${position ? `, ${position}` : ""}`,
        detail: `${who} ${keepsGoing}`,
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
        const summary = lastStep.report?.summary;
        const why =
          lastStep.pauseReason === "retry_exhausted"
            ? `${name} used up its retries after ${quote(lastStep.outcome)}.`
            : `${name} reported ${quote(lastStep.outcome)}${summary ? `: ${sentence(summary)}` : "."}`;
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
      return {
        headline:
          finished?.type === "note" && finished.text.startsWith("Finished: ")
            ? `Completed — ${finished.text.slice("Finished: ".length)}`
            : "Completed",
        detail: `Finished in ${duration(status.elapsedMs)}.${tasks}`,
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
