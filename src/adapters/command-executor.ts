/**
 * Command steps (spec §2.2, §3.2): run an argv array directly, never through a shell unless the
 * workflow names one explicitly. The exit status maps onto the step's `complete`/`failed` outcomes.
 * Failures to run map to `system.*` outcomes so they route as engine errors, not agent results.
 */
import type { SystemOutcome } from "../contracts/identifiers.js";
import type { ProcessIdentity } from "../contracts/process-identity.js";
import { childEnvironment } from "./environment.js";
import {
  type ProcessResult,
  processDiagnostics,
  type RunningProcess,
  startProcess,
} from "./process.js";

export interface CommandSpec {
  readonly argv: readonly string[];
  /** Absolute working directory. */
  readonly cwd: string;
  /** Workflow `env` entries, added to the base allowlist. */
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs?: number | undefined;
  readonly logPath?: string | undefined;
}

type CommandResult =
  | {
      readonly kind: "outcome";
      readonly outcome: "complete" | "failed";
      readonly exitCode: number;
      readonly stdout: string;
    }
  | {
      readonly kind: "system";
      readonly code: SystemOutcome;
      readonly detail: string;
      readonly stdout: string;
    }
  | { readonly kind: "terminated"; readonly stdout: string };

export type CommandOutcome = CommandResult & {
  readonly diagnostics?: ReturnType<typeof processDiagnostics>;
};

export interface RunningCommand {
  readonly pid: number | null;
  readonly processIdentity: ProcessIdentity | null;
  readonly completed: Promise<CommandOutcome>;
  terminate(): Promise<void>;
}

export function startCommand(spec: CommandSpec): RunningCommand {
  const [command, ...args] = spec.argv;
  const running: RunningProcess =
    command === undefined || command === ""
      ? startProcess({ command: "", args: [], cwd: spec.cwd, env: {} })
      : startProcess({
          command,
          args,
          cwd: spec.cwd,
          env: childEnvironment(spec.env),
          timeoutMs: spec.timeoutMs,
          logPath: spec.logPath,
        });
  return {
    pid: running.pid,
    processIdentity: running.processIdentity,
    completed: running.completed.then((result) => {
      const outcome = commandOutcome(result);
      return result.stderr || result.stdoutTruncated || result.stderrTruncated
        ? { ...outcome, diagnostics: processDiagnostics(result) }
        : outcome;
    }),
    terminate: running.terminate,
  };
}

/** Pure mapping from a finished process to a command outcome (spec §4.4). */
export function commandOutcome(result: ProcessResult): CommandOutcome {
  if (result.terminated && !result.timedOut) {
    return { kind: "terminated", stdout: result.stdout };
  }
  if (result.spawnError !== null) {
    return {
      kind: "system",
      code: "system.spawn_error",
      detail:
        result.spawnError === "cwd_not_found"
          ? "working directory does not exist"
          : `could not start: ${result.spawnError}`,
      stdout: result.stdout,
    };
  }
  if (result.timedOut) {
    return {
      kind: "system",
      code: "system.timeout",
      detail: "command exceeded its timeout",
      stdout: result.stdout,
    };
  }
  if (result.signal !== null) {
    return {
      kind: "system",
      code: "system.process_error",
      detail: `command ended by signal ${result.signal}`,
      stdout: result.stdout,
    };
  }
  const exitCode = result.exitCode ?? -1;
  return {
    kind: "outcome",
    outcome: exitCode === 0 ? "complete" : "failed",
    exitCode,
    stdout: result.stdout,
  };
}
