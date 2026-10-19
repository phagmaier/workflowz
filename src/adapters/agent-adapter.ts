/**
 * The contract every agent harness adapter implements (architecture §4). An adapter launches one
 * attempt and reports what the process did. It does not decide routing: the runner maps the result
 * onto a settlement, so the same rules apply to every harness.
 *
 * Reports arrive independently through wf report. Process output has no reporting authority.
 */
import type { AgentContext } from "../contracts/agent-context.js";

export class ResumeUnavailableError extends Error {
  constructor() {
    super("the persisted agent session is unavailable");
  }
}

export interface AgentInput {
  readonly attemptId: string;
  /** Absolute working directory. */
  readonly cwd: string;
  readonly prompt: string;
  readonly model?: string | undefined;
  readonly reasoningEffort?: string | undefined;
  readonly context?: AgentContext | undefined;
  readonly instructionFiles: readonly string[];
  readonly allowedOutcomes: readonly string[];
  readonly timeoutMs?: number | undefined;
  readonly logPath?: string | undefined;
  readonly reportAccess?: { readonly endpoint: string; readonly token: string } | undefined;
  readonly priorSessionId?: string | undefined;
}

export interface AgentRunResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly terminated: boolean;
  readonly spawnError: string | null;
  readonly sessionId?: string | undefined;
  readonly providerError?: string | undefined;
  readonly completionError?: boolean | undefined;
  readonly resumeUnavailable?: boolean | undefined;
  readonly stdout: string;
}

export interface AgentHandle {
  readonly pid: number | null;
  readonly sessionId?: string | undefined;
  readonly launchInfo?: {
    readonly harnessVersion: string;
    readonly permissionMode: string;
  };
  readonly completed: Promise<AgentRunResult>;
  /** Ends the attempt's whole process tree. Resolves once it has been reaped. */
  terminate(): Promise<void>;
}

export interface AgentAdapter {
  /** The `harness` id this adapter serves, as written in workflow files. */
  readonly id: string;
  start(input: AgentInput): AgentHandle;
  /** Must resume the exact persisted identity; never silently create a fresh session. */
  readonly resumeForReportCorrection?:
    | ((input: AgentInput & { readonly priorSessionId: string }) => AgentHandle)
    | undefined;
}
