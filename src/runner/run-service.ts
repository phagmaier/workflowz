/**
 * The runner: drives a run one attempt at a time (spec §1.1 principle 5, architecture §7.1).
 *
 * `drive` asks the coordinator for the next step. An agent or command attempt is run here, and its
 * result is handed back through `settle`. Only one process exists at any moment, because `drive`
 * awaits each attempt before it asks for the next.
 *
 * Control requests arrive while an attempt is in flight:
 * - `requestPause` is recorded in the database; the run stops once the attempt has settled.
 * - `stop` terminates the attempt's process tree, waits for it to be reaped, and only then records
 *   the stop. The attempt is never settled as if it had finished.
 */
import { mkdirSync } from "node:fs";
import {
  AdapterPreflightError,
  type AgentAdapter,
  type AgentHandle,
  type AgentRunResult,
  ResumeUnavailableError,
} from "../adapters/agent-adapter.js";
import {
  type CommandOutcome,
  type RunningCommand,
  startCommand,
} from "../adapters/command-executor.js";
import type { TaskOverrideEdit, WorkflowRevisionInput } from "../contracts/run-configuration.js";
import type { RunStatus } from "../contracts/run-state.js";
import {
  type AdvanceResult,
  type CoordinatorOptions,
  RunCoordinator,
  type Settlement,
} from "../engine/run-coordinator.js";
import type { WorkflowDatabase } from "../store/database.js";
import type { AttemptRow } from "../store/run-store.js";
import { PreparationError, type PreparedAttempt, prepareAttempt } from "./prepare.js";
import { ReportServer } from "./report-server.js";
import { settlementForAgent, settlementForCommand } from "./settlement.js";
import { readTaskImport } from "./task-import.js";

export interface RunServiceOptions extends CoordinatorOptions {
  /** Agent adapters keyed by harness id. Missing adapters fail before a subprocess is launched. */
  readonly agents: ReadonlyMap<string, AgentAdapter>;
  /** Directory for per-attempt log files. Created if missing. */
  readonly logDir: string;
  /** Hard upper bound for the one report-only follow-up, default 30 seconds. */
  readonly correctionTimeoutMs?: number;
}

export type DriveResult =
  | { readonly kind: "completed" }
  | { readonly kind: "not_running"; readonly status: RunStatus }
  | { readonly kind: "stopped" };

interface Terminable {
  terminate(): Promise<void>;
}

export class RunService {
  readonly coordinator: RunCoordinator;
  private readonly reports: ReportServer;
  private current: Terminable | undefined;
  private inFlight: Promise<void> | undefined;
  private stopRequested = false;
  private drivingRunId: string | undefined;

  constructor(
    database: WorkflowDatabase,
    private readonly options: RunServiceOptions,
  ) {
    mkdirSync(options.logDir, { recursive: true });
    this.coordinator = new RunCoordinator(database, options);
    this.reports = new ReportServer(this.coordinator);
    if (
      options.correctionTimeoutMs !== undefined &&
      (!Number.isFinite(options.correctionTimeoutMs) ||
        options.correctionTimeoutMs <= 0 ||
        options.correctionTimeoutMs > 30_000)
    )
      throw new Error("correction timeout must be between 0 and 30000 ms");
  }

  /** Preview and import read the checklist once each; createRun freezes the text it actually read. */
  previewTasks(input: { workflowText: string; workflowDir: string; includeCompleted?: boolean }) {
    return readTaskImport(input)?.preview;
  }

  createRun(input: {
    workflowText: string;
    workflowDir: string;
    includeCompleted?: boolean;
  }): string {
    const imported = readTaskImport(input);
    return this.coordinator.createRun({
      workflowText: input.workflowText,
      workflowDir: input.workflowDir,
      ...(imported ? { taskImport: imported.snapshot } : {}),
    });
  }

  setTaskOverrides(runId: string, taskId: string, edit: TaskOverrideEdit): void {
    this.coordinator.setTaskOverrides(runId, taskId, edit);
  }

  reviseWorkflow(runId: string, edit: WorkflowRevisionInput): number {
    return this.coordinator.reviseWorkflow(runId, edit);
  }

  /** Drives one run until it completes, pauses, or its stopped process tree has been reaped. */
  async drive(runId: string): Promise<DriveResult> {
    if (this.drivingRunId !== undefined) {
      throw new Error(`this runner is already driving run ${this.drivingRunId}`);
    }
    this.drivingRunId = runId;
    try {
      await this.reports.listen();
      return await this.driveRun(runId);
    } finally {
      await this.reports.close();
      this.drivingRunId = undefined;
    }
  }

  private async driveRun(runId: string): Promise<DriveResult> {
    for (;;) {
      if (this.stopRequested) {
        return { kind: "stopped" };
      }
      const next: AdvanceResult = this.coordinator.advance(runId);
      if (next.kind === "attempt") {
        await this.runAttempt(runId, next.attemptId);
        continue;
      }
      if (next.kind === "in_progress") {
        throw new Error(
          `attempt ${next.attemptId} is still marked active, but this runner is not executing it; reconcile the run first`,
        );
      }
      return next.kind === "completed"
        ? { kind: "completed" }
        : { kind: "not_running", status: next.status };
    }
  }

  /** Pause after the current step. Never interrupts a running attempt. */
  requestPause(runId: string): void {
    this.coordinator.requestPause(runId);
  }

  /**
   * Stop now. Terminates the in-flight attempt's process tree, waits until it is reaped, and records
   * the stop. With no attempt in flight, it records the stop immediately. Once stopped, this service
   * instance stops driving; start a new one to continue other runs.
   */
  async stop(runId: string, reason = "stopped by request"): Promise<void> {
    if (this.drivingRunId !== runId || this.inFlight === undefined) {
      if (this.coordinator.activeAttempt(runId) !== undefined) {
        throw new Error(
          `this runner does not own the active attempt of run ${runId}; reconcile it first`,
        );
      }
      this.coordinator.recordStop(runId, reason);
      return;
    }
    this.stopRequested = true;
    this.reports.expireAll();
    await this.current?.terminate();
    await this.inFlight;
    this.coordinator.recordStop(runId, reason);
  }

  /** Startup reconciliation. Returns true when an attempt left active by a previous process was found. */
  reconcile(runId: string): boolean {
    if (this.drivingRunId === runId) {
      throw new Error(`cannot reconcile run ${runId} while this runner is driving it`);
    }
    return this.coordinator.reconcileAfterRestart(runId);
  }

  private async runAttempt(runId: string, attemptId: string): Promise<void> {
    const work = this.execute(runId, attemptId);
    this.inFlight = work;
    try {
      await work;
    } finally {
      this.inFlight = undefined;
    }
  }

  private async execute(runId: string, attemptId: string): Promise<void> {
    const attempt = this.attemptRow(runId, attemptId);
    let prepared: PreparedAttempt;
    try {
      prepared = this.prepare(runId, attempt);
    } catch (error) {
      if (error instanceof PreparationError) {
        this.coordinator.settle(attemptId, {
          kind: "system",
          code: error.code,
          detail: error.message,
        });
        return;
      }
      throw error;
    }

    if (prepared.kind === "agent") {
      if (!prepared.input.context) throw new Error("agent preparation omitted context");
      const agentSpec = this.coordinator
        .workflowForAttempt(attempt)
        .steps.get(attempt.stepId)?.spec;
      if (agentSpec?.kind !== "agent") throw new Error("agent attempt has no agent specification");
      this.coordinator.recordInput(attemptId, {
        harness: agentSpec.harness,
        ...(prepared.input.model === undefined ? {} : { model: prepared.input.model }),
        ...(prepared.input.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: prepared.input.reasoningEffort }),
        cwd: prepared.input.cwd,
        prompt: prepared.input.prompt,
        context: prepared.input.context,
        allowedOutcomes: prepared.input.allowedOutcomes,
      });
      const settlement = await this.runAgent(runId, attemptId, prepared);
      if (!this.stopRequested) this.coordinator.settle(attemptId, settlement);
      return;
    }
    let running: RunningCommand;
    try {
      running = startCommand(prepared.spec);
    } catch {
      this.coordinator.settle(attemptId, {
        kind: "system",
        code: "system.spawn_error",
        detail: "command launch failed",
      });
      return;
    }
    this.current = running;
    let result: CommandOutcome;
    try {
      result = await running.completed;
    } catch {
      // A broken completion promise does not prove the process has settled.
      await running.terminate();
      this.current = undefined;
      if (!this.stopRequested)
        this.coordinator.settle(attemptId, {
          kind: "system",
          code: "system.internal_error",
          detail: "command completion failed",
        });
      return;
    }
    this.current = undefined;
    this.coordinator.recordOutput(attemptId, {
      stdout: result.stdout,
      logPath: prepared.spec.logPath ?? null,
    });
    if (!this.stopRequested) this.coordinator.settle(attemptId, settlementForCommand(result));
  }

  private async runAgent(
    runId: string,
    attemptId: string,
    prepared: Extract<PreparedAttempt, { kind: "agent" }>,
  ): Promise<Settlement> {
    const reportError = (): Settlement => ({
      kind: "system",
      code: "system.report_error",
      detail:
        "no accepted report after clean execution; correction was unavailable, disabled, or failed",
    });
    const original = await this.invokeAgent(attemptId, prepared, 0);
    if (!original || this.stopRequested) return reportError();
    const accepted = this.coordinator.reportFor(attemptId);
    const first = settlementForAgent(
      original,
      prepared.input.allowedOutcomes,
      accepted?.outcome ?? null,
    );
    if (first.kind !== "system" || first.code !== "system.report_error") return first;
    const sessionId = this.attemptRow(runId, attemptId).sessionId;
    if (
      this.coordinator.workflowFor(runId).reportCorrectionAttempts === 0 ||
      !prepared.adapter.capabilities.supportsResume ||
      !prepared.adapter.resumeForReportCorrection ||
      !sessionId
    )
      return reportError();
    this.coordinator.requestCorrection(attemptId);
    const input = {
      ...prepared.input,
      priorSessionId: sessionId,
      context: undefined,
      instructionFiles: [],
      prompt: `The prior execution ended without a valid report. Do not modify source files. Submit only a compliant report using wf report <outcome> --summary <non-empty text>. Allowed outcomes: ${prepared.input.allowedOutcomes.join(", ")}. Schema v1: {outcome, summary, issue?: string|null, handoff?: string, data?: object}. Summary/issue max 4096 UTF-8 bytes; handoff max 65536; data max 32768; total max 131072. No further implementation work.`,
      timeoutMs: Math.min(
        prepared.input.timeoutMs ?? 30_000,
        this.options.correctionTimeoutMs ?? 30_000,
      ),
      logPath:
        prepared.input.logPath === undefined ? undefined : `${prepared.input.logPath}.correction`,
    };
    const corrected = await this.invokeAgent(attemptId, { ...prepared, input }, 1);
    if (!corrected || this.stopRequested) return reportError();
    const last = settlementForAgent(
      corrected,
      input.allowedOutcomes,
      this.coordinator.reportFor(attemptId)?.outcome ?? null,
    );
    return last.kind === "outcome" ? last : reportError();
  }

  /** Revocation precedes any correction/routing. Cleanup uncertainty propagates with attempt active. */
  private async invokeAgent(
    attemptId: string,
    prepared: Extract<PreparedAttempt, { kind: "agent" }>,
    invocation: 0 | 1,
  ): Promise<AgentRunResult | undefined> {
    const access = this.reports.issue(attemptId);
    const input = {
      ...prepared.input,
      reportAccess: access,
      prompt: `${prepared.input.prompt}\nReport through wf report <outcome> --summary <text>. Allowed outcomes: ${prepared.input.allowedOutcomes.join(", ")}. A report does not end this process.`,
    };
    try {
      let running: AgentHandle;
      try {
        if (invocation === 1) {
          if (!input.priorSessionId || !prepared.adapter.resumeForReportCorrection)
            return undefined;
          running = prepared.adapter.resumeForReportCorrection({
            ...input,
            priorSessionId: input.priorSessionId,
          });
        } else running = prepared.adapter.start(input);
      } catch (error) {
        return {
          resumeUnavailable: error instanceof ResumeUnavailableError,
          exitCode: null,
          signal: null,
          timedOut: false,
          terminated: false,
          spawnError:
            error instanceof AdapterPreflightError
              ? error.message.replaceAll(access.token, "[redacted]")
              : "adapter launch failed",
          stdout: "",
        };
      }
      this.current = running;
      const sessionId = running.sessionId;
      if (sessionId?.includes(access.token)) {
        await running.terminate();
        this.current = undefined;
        return {
          exitCode: null,
          signal: null,
          timedOut: false,
          terminated: true,
          spawnError: null,
          completionError: true,
          stdout: "",
        };
      }
      try {
        this.coordinator.recordInvocation(attemptId, invocation, "started", {
          ...running.launchInfo,
          pid: running.pid,
          sessionId,
          logPath: input.logPath,
        });
      } catch (error) {
        await running.terminate();
        this.current = undefined;
        throw error;
      }
      let result: AgentRunResult;
      try {
        result = await running.completed;
        if (result.spawnError)
          result = {
            ...result,
            spawnError: result.spawnError.replaceAll(access.token, "[redacted]"),
          };
      } catch {
        await running.terminate();
        this.current = undefined;
        result = {
          exitCode: null,
          signal: null,
          timedOut: false,
          terminated: true,
          spawnError: null,
          completionError: true,
          stdout: "",
        };
      }
      this.current = undefined;
      // The adapter must positively identify the same persisted session on correction.
      const finalSession = result.sessionId ?? sessionId;
      if (finalSession?.includes(access.token)) return { ...result, completionError: true };
      const wrongSession = invocation === 1 && finalSession !== input.priorSessionId;
      const observed = settlementForAgent(result, input.allowedOutcomes);
      this.coordinator.recordInvocation(attemptId, invocation, "settled", {
        pid: running.pid,
        sessionId: wrongSession ? input.priorSessionId : finalSession,
        logPath: input.logPath,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        failure: wrongSession
          ? "system.resume_unavailable"
          : observed.kind === "system" && observed.code !== "system.report_error"
            ? observed.code
            : undefined,
      });
      this.coordinator.recordOutput(attemptId, {
        stdout: result.stdout.replaceAll(access.token, "[redacted]"),
        logPath: input.logPath ?? null,
      });
      return wrongSession ? undefined : result;
    } finally {
      this.reports.revoke(access);
    }
  }

  private prepare(runId: string, attempt: AttemptRow): PreparedAttempt {
    const workflow = this.coordinator.workflowForAttempt(attempt);
    const step = workflow.steps.get(attempt.stepId);
    if (!step) {
      throw new PreparationError(`step '${attempt.stepId}' is not declared by the workflow`);
    }
    const task =
      attempt.taskId === null
        ? undefined
        : this.coordinator.tasks(runId).find((row) => row.taskId === attempt.taskId);
    return prepareAttempt({
      workflow,
      runId,
      step,
      attemptId: attempt.attemptId,
      task,
      logDir: this.options.logDir,
      adapters: this.options.agents,
      priorSessionId: this.coordinator.priorSession(attempt),
      report: (stepId) => this.coordinator.latestReport(runId, stepId, attempt.taskId),
      commandStdout: (stepId) => this.coordinator.latestStdout(runId, stepId),
    });
  }

  private attemptRow(runId: string, attemptId: string): AttemptRow {
    const found = this.coordinator.activeAttempt(runId);
    if (!found || found.attemptId !== attemptId) {
      throw new Error(`attempt ${attemptId} is not the active attempt of run ${runId}`);
    }
    return found;
  }
}
