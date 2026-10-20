/** One daemon facade owns drive and control. HTTP/CLI never mutate cursors themselves. */
import type { AgentAdapter } from "../adapters/agent-adapter.js";
import { BUILT_IN_HARNESSES } from "../adapters/harness-registry.js";
import { createInstalledAdapter } from "../adapters/probe.js";
import type { ManagementRequest } from "../contracts/management.js";
import { revisionCursor } from "../engine/run-configuration.js";
import { RunStateError, WorkflowInvalidError } from "../engine/run-coordinator.js";
import { RunService } from "../runner/run-service.js";
import type { WorkflowDatabase } from "../store/database.js";
import type {
  AttemptRow,
  AttentionRow,
  EventRow,
  ReportRow,
  RunRow,
  TaskRow,
} from "../store/run-store.js";
import { RunStore } from "../store/run-store.js";
import { validateWorkflow } from "./workflow-validation.js";
export interface BrowserRunStatus {
  run: RunRow;
  expectedEventId: number;
  activeAttempt: AttemptRow | null;
  current: {
    kind: string;
    harness?: string;
    model?: string | null;
    reasoningEffort?: string | null;
  } | null;
  elapsedMs: number;
  progress: { completed: number; total: number } | null;
  tasks: readonly TaskRow[];
  latestReport: ReportRow | null;
  attention: readonly AttentionRow[];
  driveFailure: string | null;
}
export interface BrowserEvents {
  events: readonly EventRow[];
  nextAfter: number;
  hasMore: boolean;
}

const READS = new Set([
  "ping",
  "validate",
  "preview",
  "workflows",
  "runs",
  "status",
  "tasks",
  "reports",
  "events",
  "recovery",
]);

export class ManagementService {
  readonly service: RunService;
  readonly store: RunStore;
  private readonly agents: Map<string, AgentAdapter>;
  private drive: Promise<void> | undefined;
  private control: Promise<unknown> | undefined;
  private closing = false;
  private driveFailure: string | undefined;

  constructor(
    private readonly database: WorkflowDatabase,
    logDir: string,
    agents = new Map<string, AgentAdapter>(),
  ) {
    this.agents = agents;
    this.service = new RunService(database, { agents, logDir });
    this.store = new RunStore(database, () => new Date().toISOString());
  }

  async handle(request: ManagementRequest): Promise<unknown> {
    if (READS.has(request.op)) return this.dispatch(request);
    if (this.closing)
      throw new RunStateError("daemon is shutting down; no new controls are accepted");
    if (this.control)
      throw new RunStateError("another control is settling; inspect status before trying again");
    const control = this.dispatch(request);
    this.control = control;
    try {
      return await control;
    } finally {
      this.control = undefined;
    }
  }

  requestShutdown(): void {
    this.closing = true;
    // Pause before acknowledging admission: settlement can precede deferred daemon teardown.
    const active = this.store.activeRunId();
    if (active && this.service.coordinator.run(active).status === "running")
      this.service.requestPause(active);
  }

  async shutdown(): Promise<void> {
    this.requestShutdown();
    await this.control?.catch(() => {});
    // Recheck after any control that was already admitted has settled.
    this.requestShutdown();
    await this.drive;
  }

  private checked(
    input: { workflowText: string; workflowDir: string },
    options?: { taskSourceConsumed?: boolean },
  ) {
    const result = validateWorkflow(input, options);
    if (!result.valid) throw new WorkflowInvalidError(result.diagnostics);
    return result;
  }

  private expect(runId: string, expected: number): void {
    this.store.getRun(runId);
    if (this.store.latestEventId(runId) !== expected)
      throw new RunStateError("stale control request; inspect status and use its expectedEventId");
  }

  private async begin(runId: string, expected: number, resumeReason?: string) {
    if (this.drive) throw new RunStateError("the previous drive is still settling");
    this.expect(runId, expected);
    const coordinator = this.service.coordinator;
    const run = coordinator.run(runId);
    if (resumeReason !== undefined && run.status === "interrupted")
      throw new RunStateError(
        "interrupted runs require an explicit recovery decision before resume",
      );
    if (run.status !== (resumeReason === undefined ? "ready" : "paused"))
      throw new RunStateError(
        `run ${runId} is ${run.status}; ${resumeReason === undefined ? "start requires ready" : "resume requires paused"}`,
      );
    const workflow = coordinator.workflowFor(runId);
    const revision = this.store.getRevision(run.revisionId);
    this.checked(
      { workflowText: revision.definitionYaml, workflowDir: revision.sourceDir },
      { taskSourceConsumed: true },
    );
    for (const step of workflow.steps.values()) {
      if (step.spec.kind !== "agent" || this.agents.has(step.spec.harness)) continue;
      const descriptor = BUILT_IN_HARNESSES.get(step.spec.harness);
      if (!descriptor) throw new Error(`unsupported adapter '${step.spec.harness}'`);
      this.agents.set(descriptor.id, await createInstalledAdapter(descriptor));
    }
    if (this.closing) throw new RunStateError("daemon is shutting down");
    this.expect(runId, expected);
    if (resumeReason === undefined) coordinator.start(runId);
    else coordinator.resume(runId, resumeReason);
    this.driveFailure = undefined;
    this.drive = this.service
      .drive(runId)
      .then(
        () => {},
        () => {
          this.driveFailure = `run ${runId} drive failed; inspect recovery before further execution`;
          // drive has released its process-wide guard; uncertain work is never dispatched again.
          try {
            this.service.reconcile(runId);
          } catch {
            /* retained active state still blocks execution */
          }
        },
      )
      .finally(() => {
        this.drive = undefined;
      });
    return { runId, accepted: true };
  }

  private async dispatch(request: ManagementRequest): Promise<unknown> {
    const c = this.service.coordinator;
    if ("expectedEventId" in request) this.expect(request.runId, request.expectedEventId);
    switch (request.op) {
      case "ping":
        return { version: 1, closing: this.closing, driveFailure: this.driveFailure ?? null };
      case "shutdown":
        throw new Error("shutdown is handled by daemon lifecycle");
      case "browser-access":
        throw new Error("browser access is handled by daemon transport");
      case "validate":
        return validateWorkflow(request);
      case "import": {
        const result = this.checked(request);
        return {
          revisionId: this.store.saveRevision(
            request.workflowText,
            result.sourceSha256,
            request.workflowDir,
          ),
          ...result,
        };
      }
      case "workflows":
        return this.store.listRevisions();
      case "preview":
        this.checked(request);
        return (
          this.service.previewTasks({
            ...request,
            includeCompleted: request.includeCompleted ?? false,
          }) ?? null
        );
      case "create":
        this.checked(request);
        return {
          runId: this.service.createRun({
            ...request,
            includeCompleted: request.includeCompleted ?? false,
          }),
        };
      case "create-import": {
        const revision = this.store.getRevision(request.revisionId);
        const input = {
          workflowText: revision.definitionYaml,
          workflowDir: revision.sourceDir,
          ...(request.includeCompleted === undefined
            ? {}
            : { includeCompleted: request.includeCompleted }),
        };
        this.checked(input);
        return { runId: this.service.createRun(input) };
      }
      case "runs":
        return this.store.listRuns();
      case "status":
        return this.database.transaction(() => {
          const run = c.run(request.runId);
          const activeAttempt = c.activeAttempt(request.runId);
          const workflow = activeAttempt
            ? c.workflowForAttempt(activeAttempt)
            : c.workflowForCurrentTask(request.runId);
          const step = workflow.steps.get(run.cursorStepId)?.spec;
          const tasks = c.tasks(request.runId);
          return {
            run,
            expectedEventId: this.store.latestEventId(request.runId),
            activeAttempt: activeAttempt ?? null,
            current: step
              ? {
                  kind: step.kind,
                  ...(step.kind === "agent"
                    ? {
                        harness: step.harness,
                        model: step.model ?? null,
                        reasoningEffort: step.reasoning_effort ?? null,
                      }
                    : {}),
                }
              : null,
            elapsedMs: run.startTime
              ? Math.max(
                  0,
                  Date.parse(run.endTime ?? new Date().toISOString()) - Date.parse(run.startTime),
                )
              : 0,
            progress:
              workflow.tasksSourcePath === undefined
                ? null
                : {
                    completed: tasks.filter((task) => task.state === "completed").length,
                    total: tasks.length,
                  },
            tasks,
            latestReport:
              this.store
                .listAttempts(request.runId)
                .map((a) => c.reportFor(a.attemptId))
                .filter(Boolean)
                .at(-1) ?? null,
            attention: this.store.listAttention(request.runId),
            driveFailure: this.driveFailure ?? null,
          } satisfies BrowserRunStatus;
        });
      case "tasks":
        c.run(request.runId);
        return c
          .tasks(request.runId)
          .map((task) => ({ ...task, overrides: c.taskOverrides(request.runId, task.taskId) }));
      case "reports":
        c.run(request.runId);
        return this.store.listAttempts(request.runId).flatMap((a) => {
          const report = c.reportFor(a.attemptId);
          return report ? [report] : [];
        });
      case "events": {
        c.run(request.runId);
        const rows = this.store.listEvents(request.runId, request.after, request.limit + 1);
        const events = rows.slice(0, request.limit);
        return {
          events,
          nextAfter: events.at(-1)?.eventId ?? request.after,
          hasMore: rows.length > request.limit,
        } satisfies BrowserEvents;
      }
      case "start":
        return this.begin(request.runId, request.expectedEventId);
      case "resume":
        return this.begin(request.runId, request.expectedEventId, request.reason);
      case "pause":
        this.service.requestPause(request.runId);
        break;
      case "stop": {
        if (c.run(request.runId).status === "interrupted")
          throw new RunStateError("interrupted runs require recovery-decide with action end");
        const drive = this.store.activeRunId() === request.runId ? this.drive : undefined;
        await this.service.stop(request.runId, request.reason);
        await drive;
        break;
      }
      case "override": {
        if (c.run(request.runId).status === "interrupted")
          throw new RunStateError("interrupted runs require recovery-decide");
        const edit = request.edit;
        if (edit.action === "jump") {
          const run = c.run(request.runId);
          const workflow = c.workflowFor(request.runId);
          revisionCursor(workflow, workflow, run.cursorStepId, run.activeTaskId, edit.stepId);
          c.jumpTo(request.runId, edit.stepId, edit.reason);
        } else if (edit.action === "skip")
          c.skipCurrentStep(request.runId, edit.outcome, edit.reason);
        else c.markTaskComplete(request.runId, edit.taskId, edit.reason);
        break;
      }
      case "revise": {
        const revision = this.store.getRevision(c.run(request.runId).revisionId);
        this.checked(
          { workflowText: request.edit.workflowText, workflowDir: revision.sourceDir },
          { taskSourceConsumed: true },
        );
        return { revisionId: this.service.reviseWorkflow(request.runId, request.edit) };
      }
      case "task-overrides":
        this.service.setTaskOverrides(request.runId, request.taskId, request.edit);
        break;
      case "recovery":
        return this.service.recovery(request.runId);
      case "reconcile":
        this.service.reconcile(request.runId);
        return this.service.recovery(request.runId);
      case "recovery-terminate":
        await this.service.terminateRecovery(request.runId, request.request);
        break;
      case "recovery-confirm":
        this.service.confirmExternalCleanup(request.runId, request.request);
        break;
      case "recovery-decide":
        this.service.decideRecovery(request.runId, request.request);
        break;
    }
    return { runId: "runId" in request ? request.runId : null, accepted: true };
  }
}
