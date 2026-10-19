/**
 * The contract every agent harness adapter implements (architecture §4). An adapter launches one
 * attempt and reports what the process did. It does not decide routing: the runner maps the result
 * onto a settlement, so the same rules apply to every harness.
 *
 * Phase 3 uses a process-backed scripted adapter for tests. Reports arrive as an `OUTCOME` line on
 * stdout there. From phase 4 they arrive through `wf report` for every adapter.
 */
export interface AgentInput {
  readonly attemptId: string;
  /** Absolute working directory. */
  readonly cwd: string;
  readonly prompt: string;
  readonly instructionFiles: readonly string[];
  readonly allowedOutcomes: readonly string[];
  readonly timeoutMs?: number | undefined;
  readonly logPath?: string | undefined;
}

export interface AgentRunResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly terminated: boolean;
  readonly spawnError: string | null;
  /** The outcome the agent reported, or null when it reported none. */
  readonly reportedOutcome: string | null;
  readonly stdout: string;
}

export interface AgentHandle {
  readonly pid: number | null;
  readonly completed: Promise<AgentRunResult>;
  /** Ends the attempt's whole process tree. Resolves once it has been reaped. */
  terminate(): Promise<void>;
}

export interface AgentAdapter {
  /** The `harness` id this adapter serves, as written in workflow files. */
  readonly id: string;
  start(input: AgentInput): AgentHandle;
}
