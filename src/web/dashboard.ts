/// <reference lib="dom" />
/** Inspection cursors authorize one deliberate control, never an automatic retry. */
import type { BrowserEvents, BrowserRunStatus } from "../app/management-service.js";
import type { BrowserRequest } from "../contracts/browser.js";
import type { ReportRow } from "../store/run-store.js";

const node = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string, value: string) => {
  node(id).textContent = value;
};
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export class RunDashboard {
  private runId = "";
  private status: BrowserRunStatus | null = null;
  private after = 0;
  private generation = 0;
  private refreshing = false;
  private controlling = false;
  private timer: number | undefined;
  private reportSnapshot = "";

  constructor(private readonly api: <T>(request: BrowserRequest) => Promise<T>) {
    node("run-refresh").addEventListener("click", () => {
      void this.refresh();
    });
    for (const op of ["start", "pause", "stop", "resume"] as const) {
      node(`run-${op}`).addEventListener("click", () => {
        void this.control(op);
      });
    }
  }

  disconnect(): void {
    clearTimeout(this.timer);
    this.generation++;
    this.runId = "";
    this.status = null;
    node("dashboard").hidden = true;
  }

  async select(runId: string): Promise<void> {
    clearTimeout(this.timer);
    if (this.controlling) return;
    this.generation++;
    this.runId = runId;
    this.status = null;
    this.after = 0;
    this.reportSnapshot = "";
    node("run-events").replaceChildren();
    node("run-reports").replaceChildren();
    node<HTMLInputElement>("run-reason").value = "";
    node("dashboard").hidden = false;
    text("run-heading", `Run ${runId}`);
    this.sync();
    await this.refresh();
  }

  sync(): void {
    const state = this.status?.run.status;
    for (const [op, allowed] of Object.entries({
      start: state === "ready",
      pause: state === "running",
      stop: state === "ready" || state === "running" || state === "pausing" || state === "paused",
      resume: state === "paused",
    }))
      node<HTMLButtonElement>(`run-${op}`).disabled =
        !allowed || this.controlling || this.refreshing;
    node<HTMLButtonElement>("run-refresh").disabled = this.controlling || this.refreshing;
  }

  private render(status: BrowserRunStatus): void {
    const { run, current, tasks, activeAttempt, progress } = status;
    const task = tasks.find((item) => item.taskId === run.activeTaskId);
    const index = task ? tasks.indexOf(task) + 1 : null;
    text(
      "run-state",
      `${run.status} · revision ${run.revisionId} · inspected event ${status.expectedEventId}`,
    );
    text("run-stage", `${run.cursorStepId} · ${current?.kind ?? "unknown"}`);
    text(
      "run-task",
      task
        ? `${index}/${tasks.length} · ${task.title} · ${task.taskId}\n${task.headingPath.join(" / ")}\n${task.body}`
        : "No active task",
    );
    text(
      "run-executor",
      current?.kind === "agent"
        ? `${current.harness} · model: ${current.model ?? "harness default"} · reasoning: ${current.reasoningEffort ?? "harness default"}`
        : current?.kind === "command"
          ? "Command process"
          : "Engine stage",
    );
    text(
      "run-elapsed",
      `${Math.floor(status.elapsedMs / 1000)}s since run start (includes pauses)${activeAttempt ? ` · attempt ${activeAttempt.attemptId} · started ${activeAttempt.startedAt}` : ""}`,
    );
    text(
      "run-progress",
      progress
        ? `${progress.completed} / ${progress.total} tasks accepted complete${progress.total > 0 ? ` (${Math.floor((progress.completed / progress.total) * 100)}%)` : " · empty imported queue"}`
        : "Graph-only workflow · task total unknown; no percentage",
    );
    text(
      "run-barrier",
      status.driveFailure ??
        (run.status === "interrupted"
          ? "Interrupted: use CLI recovery inspection and an explicit recovery decision before resume. No work is replayed here."
          : run.status === "pausing"
            ? "Pause requested. Waiting for the current operation and report channel to settle."
            : run.retryNotBefore
              ? `Retry admission not before ${run.retryNotBefore}`
              : "Controls affect the daemon-owned run. Closing this browser does not stop execution."),
    );
    text(
      "run-latest",
      status.latestReport
        ? `${status.latestReport.outcome}: ${status.latestReport.summary} · attempt ${status.latestReport.attemptId}`
        : "No accepted report yet",
    );
    text(
      "run-attention",
      status.attention.length
        ? status.attention
            .map(
              (item) =>
                `${item.severity} · ${item.category} · item ${item.itemId} · attempt ${item.attemptId ?? "none"}\n${item.message}\n${item.createdAt}`,
            )
            .join("\n\n")
        : "No attention items",
    );
  }

  private async refresh(): Promise<void> {
    clearTimeout(this.timer);
    if (!this.runId || this.refreshing || this.controlling) return;
    const runId = this.runId;
    const generation = this.generation;
    this.refreshing = true;
    this.sync();
    try {
      const status = await this.api<BrowserRunStatus>({ op: "status", runId });
      const reports = await this.api<ReportRow[]>({ op: "reports", runId });
      const page = await this.api<BrowserEvents>({
        op: "events",
        runId,
        after: this.after,
        limit: 100,
      });
      if (generation !== this.generation) return;
      this.status = status;
      this.render(status);
      const snapshot = pretty(reports);
      if (snapshot !== this.reportSnapshot) {
        this.reportSnapshot = snapshot;
        node("run-reports").replaceChildren();
        for (const report of reports) {
          const details = document.createElement("details");
          const summary = document.createElement("summary");
          summary.textContent = `${report.outcome} · attempt ${report.attemptId} · ${report.receivedAt}`;
          const body = document.createElement("pre");
          body.textContent = pretty(report);
          details.append(summary, body);
          node("run-reports").append(details);
        }
      }
      for (const event of page.events) {
        const entry = document.createElement("pre");
        entry.textContent = `#${event.eventId} · ${event.timestamp} · ${event.type} · revision ${event.revisionId ?? "none"} · attempt ${event.attemptId ?? "none"}\n${pretty(event.data)}`;
        node("run-events").append(entry);
      }
      const events = node("run-events");
      while (events.childElementCount > 300) events.firstElementChild?.remove();
      this.after = page.nextAfter;
      text(
        "run-event-cursor",
        `Exclusive event cursor ${this.after}. Showing up to 300 most recently fetched events. ${page.hasMore ? "More history pending; refresh fetches the next page." : "Caught up at last refresh."}`,
      );
      text("run-error", "");
      text("run-updated", `Inspected ${new Date().toLocaleTimeString()} · auto-refresh every 2s`);
      this.timer = window.setTimeout(() => {
        void this.refresh();
      }, 2000);
    } catch (error) {
      if (generation !== this.generation) return;
      this.status = null;
      text("run-error", error instanceof Error ? error.message : "Inspection failed");
      text("run-updated", "Refresh stopped. Inspect again explicitly before controlling this run.");
    } finally {
      this.refreshing = false;
      this.sync();
      // A selection made during an in-flight refresh must not retain the previous run's view.
      if (generation !== this.generation && this.runId) void this.refresh();
    }
  }

  private async control(op: "start" | "pause" | "stop" | "resume"): Promise<void> {
    if (!this.status || this.controlling || this.refreshing) return;
    const runId = this.runId;
    const expectedEventId = this.status.expectedEventId;
    const reason = node<HTMLInputElement>("run-reason").value.trim();
    if ((op === "stop" || op === "resume") && !reason) {
      text("run-error", "Enter a reason before Stop now or Resume.");
      return;
    }
    clearTimeout(this.timer);
    this.controlling = true;
    this.sync();
    text("run-error", "");
    text(
      "run-updated",
      op === "stop"
        ? "Stop requested; awaiting process settlement…"
        : "Submitting explicit control…",
    );
    try {
      await this.api(
        op === "stop" || op === "resume"
          ? { op, runId, expectedEventId, reason }
          : { op, runId, expectedEventId },
      );
      this.status = null;
      text("run-updated", `${op} acknowledged. Refresh to inspect the resulting state.`);
    } catch (error) {
      this.status = null;
      text("run-error", error instanceof Error ? error.message : "Control failed");
      text(
        "run-updated",
        "No automatic retry. Refresh and inspect before another control; a timed-out operation may have committed.",
      );
    } finally {
      this.controlling = false;
      this.sync();
    }
    // Rejections intentionally require explicit inspection, not a renewed control cursor.
    if (!node("run-error").textContent) await this.refresh();
  }
}
