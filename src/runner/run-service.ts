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
import type { AgentAdapter } from "../adapters/agent-adapter.js";
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
  /** Agent adapters keyed by harness id. A workflow step naming an unregistered harness fails before start. */
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

  constructor(
    database: WorkflowDatabase,
    private readonly options: RunServiceOptions,
  ) {
    mkdirSync(options.logDir, { recursive: true });
    this.coordinator = new RunCoordinator(database, options);
  }

  /** Runs the run until it completes, pauses, or is stopped. A stop returns `stopped` at once. */
  async drive(runId: string): Promise<DriveResult> {
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
    if (this.inFlight === undefined) {
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
          code: "system.internal_error",
          detail: error.message,
        });
        return;
      }
      throw error;
    }

    if (prepared.kind === "command") {
      const running: RunningCommand = startCommand(prepared.spec);
      this.current = running;
      const outcome: CommandOutcome = await running.completed;
      this.current = undefined;
      this.coordinator.recordOutput(attemptId, {
        stdout: outcome.stdout,
        logPath: prepared.spec.logPath ?? null,
      });
      if (!this.stopRequested) {
        this.coordinator.settle(attemptId, settlementForCommand(outcome));
      }
      return;
    }

    const handle = prepared.adapter.start(prepared.input);
    this.current = handle;
    const result = await handle.completed;
    this.current = undefined;
    this.coordinator.recordOutput(attemptId, {
      stdout: result.stdout,
      logPath: prepared.input.logPath ?? null,
    });
    if (!this.stopRequested) {
      this.coordinator.settle(
        attemptId,
        settlementForAgent(result, prepared.input.allowedOutcomes),
      );
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
