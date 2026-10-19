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
import type { AgentAdapter, AgentHandle, AgentRunResult } from "../adapters/agent-adapter.js";
import {
  type CommandOutcome,
  type RunningCommand,
  startCommand,
} from "../adapters/command-executor.js";
import type { RunStatus } from "../contracts/run-state.js";
import {
  type AdvanceResult,
  type CoordinatorOptions,
  RunCoordinator,
} from "../engine/run-coordinator.js";
import type { WorkflowDatabase } from "../store/database.js";
import type { AttemptRow } from "../store/run-store.js";
import { PreparationError, type PreparedAttempt, prepareAttempt } from "./prepare.js";
import { settlementForAgent, settlementForCommand } from "./settlement.js";

export interface RunServiceOptions extends CoordinatorOptions {
  /** Agent adapters keyed by harness id. Missing adapters fail before a subprocess is launched. */
  readonly agents: ReadonlyMap<string, AgentAdapter>;
  /** Directory for per-attempt log files. Created if missing. */
  readonly logDir: string;
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
  }

  /** Drives one run until it completes, pauses, or its stopped process tree has been reaped. */
  async drive(runId: string): Promise<DriveResult> {
    if (this.drivingRunId !== undefined) {
      throw new Error(`this runner is already driving run ${this.drivingRunId}`);
    }
    this.drivingRunId = runId;
    try {
      return await this.driveRun(runId);
    } finally {
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

    let running: RunningCommand | AgentHandle;
    try {
      running =
        prepared.kind === "command"
          ? startCommand(prepared.spec)
          : prepared.adapter.start(prepared.input);
    } catch (error) {
      this.coordinator.settle(attemptId, {
        kind: "system",
        code: "system.spawn_error",
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    this.current = running;
    let result: CommandOutcome | AgentRunResult;
    try {
      result = await running.completed;
    } catch (error) {
      // A broken adapter promise does not prove its process has settled.
      await running.terminate();
      this.current = undefined;
      if (!this.stopRequested) {
        this.coordinator.settle(attemptId, {
          kind: "system",
          code: "system.internal_error",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    this.current = undefined;
    this.coordinator.recordOutput(attemptId, {
      stdout: result.stdout,
      logPath:
        (prepared.kind === "command" ? prepared.spec.logPath : prepared.input.logPath) ?? null,
    });
    if (!this.stopRequested) {
      if ("kind" in result) {
        this.coordinator.settle(attemptId, settlementForCommand(result));
      } else {
        if (prepared.kind !== "agent") {
          throw new Error("command returned an agent result");
        }
        this.coordinator.settle(
          attemptId,
          settlementForAgent(result, prepared.input.allowedOutcomes),
        );
      }
    }
  }

  private prepare(runId: string, attempt: AttemptRow): PreparedAttempt {
    const workflow = this.coordinator.workflowFor(runId);
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
