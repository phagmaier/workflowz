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
import { setTimeout as delay } from "node:timers/promises";
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
import { boundedText } from "../adapters/output.js";
import { processGroupState, signalOwnedGroup } from "../adapters/process-identity.js";
import { scrubSecrets } from "../adapters/secrets.js";
import {
  type ExternalCleanupConfirmation,
  externalCleanupSchema,
  type RecoveryDecision,
  type RecoveryRequest,
  recoveryRequestSchema,
} from "../contracts/recovery.js";
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

/** Multiple service facades may share one owner connection; only its first facade is startup. */
const initializedDatabases = new WeakSet<WorkflowDatabase>();
const drivingDatabases = new WeakSet<WorkflowDatabase>();
const recoveringDatabases = new WeakSet<WorkflowDatabase>();

export class RunService {
  readonly coordinator: RunCoordinator;
  private readonly reports: ReportServer;
  private current: Terminable | undefined;
  private inFlight: Promise<void> | undefined;
  private stopRequested = false;
  private drivingRunId: string | undefined;
  private retryWait: AbortController | undefined;

  constructor(
    private readonly database: WorkflowDatabase,
    private readonly options: RunServiceOptions,
  ) {
    if (database.readOnly) throw new Error("a read-only state connection cannot own a runner");
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
    if (!initializedDatabases.has(database)) {
      for (const runId of this.coordinator.recoveryRuns()) this.reconcile(runId);
      initializedDatabases.add(database);
    }
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
    this.assertNotRecovering();
    if (drivingDatabases.has(this.database)) {
      throw new Error("this state database is already driving a run");
    }
    this.stopRequested = false;
    this.drivingRunId = runId;
    drivingDatabases.add(this.database);
    try {
      await this.reports.listen();
      return await this.driveRun(runId);
    } finally {
      await this.reports.close();
      this.drivingRunId = undefined;
      drivingDatabases.delete(this.database);
    }
  }

  private async driveRun(runId: string): Promise<DriveResult> {
    for (;;) {
      if (this.stopRequested) {
        return { kind: "stopped" };
      }
      const next: AdvanceResult = this.coordinator.advance(runId);
      if (next.kind === "waiting") {
        const controller = new AbortController();
        this.retryWait = controller;
        try {
          await delay(Math.min(next.delayMs, 2_147_483_647), undefined, {
            signal: controller.signal,
          });
        } catch (error) {
          if (!controller.signal.aborted) throw error;
        } finally {
          this.retryWait = undefined;
        }
        continue;
      }
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
    if (this.drivingRunId === runId) this.retryWait?.abort();
  }

  /**
   * Stop now. Terminates the in-flight attempt's process tree, waits until it is reaped, and records
   * the stop. With no attempt in flight, it records the stop immediately. Once stopped, this service
   * instance stops driving; another drive can be admitted after complete settlement.
   */
  async stop(runId: string, reason = "stopped by request"): Promise<void> {
    this.assertNotRecovering();
    if (this.drivingRunId !== runId || this.inFlight === undefined) {
      if (this.coordinator.activeAttempt(runId) !== undefined) {
        throw new Error(
          `this runner does not own the active attempt of run ${runId}; reconcile it first`,
        );
      }
      this.coordinator.recordStop(runId, reason);
      if (this.drivingRunId === runId) {
        this.stopRequested = true;
        this.retryWait?.abort();
      }
      return;
    }
    this.stopRequested = true;
    this.reports.expireAll();
    await this.current?.terminate();
    await this.inFlight;
    this.coordinator.recordStop(runId, reason);
  }

  /** Reconcile persisted state without signalling or replaying any uncertain operation. */
  reconcile(runId: string): boolean {
    this.assertNotRecovering();
    if (drivingDatabases.has(this.database)) {
      throw new Error(`cannot reconcile run ${runId} while this runner is driving it`);
    }
    const observation = this.observeRecovery(this.coordinator.recoveryAttempt(runId));
    return this.coordinator.reconcileAfterRestart(runId, observation);
  }

  /** Read-only durable view; call reconcile explicitly to refresh OS observations. */
  recovery(runId: string) {
    return this.coordinator.recovery(runId);
  }

  confirmExternalCleanup(runId: string, input: ExternalCleanupConfirmation): void {
    this.assertRecoveryAvailable();
    const request = externalCleanupSchema.parse(input);
    const state = this.coordinator.recovery(runId);
    this.coordinator.confirmExternalCleanup(runId, request, this.observeRecovery(state.attempt));
  }

  decideRecovery(runId: string, input: RecoveryDecision): void {
    this.assertRecoveryAvailable();
    this.coordinator.decideRecovery(runId, input);
  }

  /** Explicit orphan termination; startup never calls this. Intent commits before the first signal. */
  async terminateRecovery(runId: string, input: RecoveryRequest): Promise<void> {
    this.assertRecoveryAvailable();
    const request = recoveryRequestSchema.parse(input);
    const state = this.coordinator.recovery(runId);
    const intent = this.coordinator.requestRecoveryTermination(
      runId,
      request,
      this.observeRecovery(state.attempt),
    );
    recoveringDatabases.add(this.database);
    try {
      const { attempt } = intent;
      try {
        for (const signal of ["SIGTERM", "SIGKILL"] as const) {
          if (this.observeRecovery(attempt) === "gone") break;
          signalOwnedGroup(attempt.pid ?? 0, attempt.processIdentity, signal);
          const deadline = Date.now() + 1000;
          while (this.observeRecovery(attempt) === "alive" && Date.now() < deadline)
            await delay(20);
        }
      } catch {
        // Persist only fresh process evidence, not an assumption that a sent signal settled work.
      }
      const observation = this.observeRecovery(attempt);
      this.coordinator.finishRecoveryTermination(runId, intent, observation);
      if (observation !== "gone")
        throw new Error(
          `recovery termination could not confirm process-group absence (${observation}); execution remains blocked`,
        );
    } finally {
      recoveringDatabases.delete(this.database);
    }
  }

  private observeRecovery(attempt: AttemptRow | null | undefined) {
    const identity = attempt?.processIdentity ?? null;
    return attempt?.pid == null
      ? "unknown"
      : identity && (identity.pid !== attempt.pid || identity.pgid !== attempt.pgid)
        ? "unknown"
        : processGroupState(attempt.pid, identity);
  }

  private assertNotRecovering(): void {
    if (recoveringDatabases.has(this.database))
      throw new Error("this state database is terminating a recovered operation");
  }

  private assertRecoveryAvailable(): void {
    this.assertNotRecovering();
    if (drivingDatabases.has(this.database))
      throw new Error("cannot decide recovery while this state database is driving a run");
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
    const timeoutMs = this.invocationTimeout(runId, prepared.spec.timeoutMs);
    if (timeoutMs === 0) {
      this.coordinator.settle(attemptId, {
        kind: "system",
        code: "system.timeout",
        detail: "the run reached its wall-time limit before command dispatch",
      });
      return;
    }
    this.coordinator.prepareInvocation(attemptId, 0);
    try {
      running = startCommand({ ...prepared.spec, timeoutMs });
    } catch {
      this.coordinator.settle(attemptId, {
        kind: "system",
        code: "system.spawn_error",
        detail: "command launch failed",
      });
      return;
    }
    this.current = running;
    try {
      this.coordinator.recordInvocation(attemptId, 0, "started", {
        pid: running.pid,
        processIdentity: running.processIdentity,
        logPath: prepared.spec.logPath,
      });
    } catch (error) {
      await running.terminate();
      this.current = undefined;
      throw error;
    }
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
    this.coordinator.recordInvocation(attemptId, 0, "settled", {
      pid: running.pid,
      processIdentity: running.processIdentity,
      logPath: prepared.spec.logPath,
      exitCode: result.kind === "outcome" ? result.exitCode : null,
      timedOut: result.kind === "system" && result.code === "system.timeout",
      failure: result.kind === "system" ? result.code : undefined,
    });
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
    const original = await this.invokeAgent(runId, attemptId, prepared, 0);
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
    if (this.coordinator.remainingWallTimeMs(runId) === 0)
      return {
        kind: "system",
        code: "system.timeout",
        detail: "the run reached its wall-time limit before report correction",
      };
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
    const corrected = await this.invokeAgent(runId, attemptId, { ...prepared, input }, 1);
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
    runId: string,
    attemptId: string,
    prepared: Extract<PreparedAttempt, { kind: "agent" }>,
    invocation: 0 | 1,
  ): Promise<AgentRunResult | undefined> {
    const timeoutMs = this.invocationTimeout(runId, prepared.input.timeoutMs);
    if (timeoutMs === 0)
      return {
        exitCode: null,
        signal: null,
        timedOut: true,
        terminated: false,
        spawnError: null,
        stdout: "",
        timeoutReason: "execution",
      };
    const access = this.reports.issue(attemptId);
    const input = {
      ...prepared.input,
      timeoutMs,
      reportAccess: access,
      prompt: `${prepared.input.prompt}\nReport through wf report <outcome> --summary <text>. Allowed outcomes: ${prepared.input.allowedOutcomes.join(", ")}. A report does not end this process.`,
    };
    try {
      this.coordinator.prepareInvocation(attemptId, invocation);
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
              ? scrubSecrets(error.message, access.secrets)
              : "adapter launch failed",
          stdout: "",
        };
      }
      this.current = running;
      this.reports.protect(access, running.secrets ?? []);
      const sessionId = running.sessionId;
      if (sessionId !== undefined && scrubSecrets(sessionId, access.secrets) !== sessionId) {
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
          ...(running.launchInfo
            ? {
                harnessVersion: scrubSecrets(running.launchInfo.harnessVersion, access.secrets),
                permissionMode: scrubSecrets(running.launchInfo.permissionMode, access.secrets),
              }
            : {}),
          pid: running.pid,
          processIdentity: running.processIdentity ?? null,
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
            spawnError: scrubSecrets(result.spawnError, access.secrets),
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
      if (finalSession !== undefined && scrubSecrets(finalSession, access.secrets) !== finalSession)
        return { ...result, completionError: true };
      const wrongSession = invocation === 1 && finalSession !== input.priorSessionId;
      const observed = settlementForAgent(result, input.allowedOutcomes);
      // Defend this durable boundary too, including adapters supplied by API callers.
      const stderr = boundedText(
        scrubSecrets(result.diagnostics?.stderr ?? "", access.secrets),
        4096,
      );
      this.coordinator.recordInvocation(attemptId, invocation, "settled", {
        pid: running.pid,
        processIdentity: running.processIdentity ?? null,
        sessionId: wrongSession ? input.priorSessionId : finalSession,
        logPath: input.logPath,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        timeoutReason: result.timedOut
          ? result.timeoutReason === "idle"
            ? "idle"
            : "execution"
          : undefined,
        ...(result.diagnostics
          ? {
              diagnostics: {
                stderr: stderr.text,
                stdoutTruncated: result.diagnostics.stdoutTruncated,
                stderrTruncated: result.diagnostics.stderrTruncated || stderr.truncated,
              },
            }
          : {}),
        failure: wrongSession
          ? "system.resume_unavailable"
          : observed.kind === "system" && observed.code !== "system.report_error"
            ? observed.code
            : undefined,
      });
      this.coordinator.recordOutput(attemptId, {
        stdout: scrubSecrets(result.stdout, access.secrets),
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

  private invocationTimeout(runId: string, configured?: number): number | undefined {
    const remaining = this.coordinator.remainingWallTimeMs(runId);
    return remaining === undefined ? configured : Math.min(configured ?? Infinity, remaining);
  }

  private attemptRow(runId: string, attemptId: string): AttemptRow {
    const found = this.coordinator.activeAttempt(runId);
    if (!found || found.attemptId !== attemptId) {
      throw new Error(`attempt ${attemptId} is not the active attempt of run ${runId}`);
    }
    return found;
  }
}
