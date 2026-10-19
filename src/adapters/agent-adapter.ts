/**
 * The contract every agent harness adapter implements (architecture §4). An adapter launches one
 * attempt and reports what the process did. It does not decide routing: the runner maps the result
 * onto a settlement, so the same rules apply to every harness.
 *
 * Reports arrive independently through wf report. Process output has no reporting authority.
 */
import type { AgentContext } from "../contracts/agent-context.js";
import type { ProcessIdentity } from "../contracts/process-identity.js";
import type { HarnessCapabilities } from "./harness-registry.js";

/** Only adapter-authored, credential-free explanations may cross the preflight boundary. */
export class AdapterPreflightError extends Error {}

export class ResumeUnavailableError extends AdapterPreflightError {
  constructor(message = "the persisted agent session is unavailable") {
    super(message);
  }
}

/** Factory snapshot, not proof of authentication, provider compatibility or session existence. */
export interface AdapterCompatibility {
  readonly version: string;
  readonly supportsResume: boolean;
  readonly supportsModelSelection: boolean;
  readonly supportsReasoningEffort: boolean;
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
  /** Redaction history remains in memory/private bridge stdin; only the current report token enters env. */
  readonly reportAccess?:
    | { readonly endpoint: string; readonly token: string; readonly secrets?: readonly string[] }
    | undefined;
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
  /** Scrubbed, bounded process evidence; independent of provider/session interpretation. */
  readonly diagnostics?: {
    readonly stderr: string;
    readonly stdoutTruncated: boolean;
    readonly stderrTruncated: boolean;
  };
}

export interface AgentHandle {
  readonly pid: number | null;
  readonly processIdentity?: ProcessIdentity | null;
  /** Known injected authorization for runner-side rejection/scrubbing; never persisted. */
  readonly secrets?: readonly string[];
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
  /** Effective capabilities of the selected CLI and this adapter's implemented transport. */
  readonly capabilities: HarnessCapabilities;
  start(input: AgentInput): AgentHandle;
  /** Must resume the exact persisted identity; never silently create a fresh session. */
  readonly resumeForReportCorrection?:
    | ((input: AgentInput & { readonly priorSessionId: string }) => AgentHandle)
    | undefined;
}

/** Check only requested features. Optional correction never makes resume mandatory for fresh work. */
export function assertAdapterCapabilities(
  adapter: Pick<AgentAdapter, "id" | "capabilities">,
  input: Pick<AgentInput, "priorSessionId" | "model" | "reasoningEffort">,
): void {
  const prefix = `harness '${adapter.id}' in the selected installed adapter`;
  if (input.priorSessionId !== undefined && !adapter.capabilities.supportsResume)
    throw new ResumeUnavailableError(`${prefix} does not support exact session resume`);
  if (input.model !== undefined && !adapter.capabilities.supportsModelSelection)
    throw new AdapterPreflightError(`${prefix} does not support model selection`);
  if (input.reasoningEffort !== undefined && !adapter.capabilities.supportsReasoningEffort)
    throw new AdapterPreflightError(`${prefix} does not support reasoning effort selection`);
}
