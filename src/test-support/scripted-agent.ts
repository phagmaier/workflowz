/**
 * A scripted agent adapter for tests. It launches test/fixtures/fake-agent.mjs, one script per
 * attempt, in the order the plan lists them. It shares the process supervisor with real adapters,
 * so every behavior tested here runs through the same code path a harness would.
 */
import path from "node:path";
import type {
  AgentAdapter,
  AgentHandle,
  AgentInput,
  AgentRunResult,
} from "../adapters/agent-adapter.js";
import { childEnvironment } from "../adapters/environment.js";
import { type ProcessResult, startProcess } from "../adapters/process.js";
import { REPO_ROOT } from "./paths.js";

export type AgentMode =
  | "report"
  | "report-then-crash"
  | "silent"
  | "crash"
  | "delay"
  | "hang"
  | "hang-with-child";

export interface AgentScript {
  readonly mode: AgentMode;
  readonly outcome?: string;
  readonly extra?: string;
}

export interface ScriptedOptions {
  /** Replaces the fake agent with this executable, to test a harness that cannot be started. */
  readonly binary?: string;
  readonly logFile?: string;
}

export const FAKE_AGENT = path.join(REPO_ROOT, "test", "fixtures", "fake-agent.mjs");

/** The outcome named on the last `OUTCOME <name>` line, or null when there is none. */
export function reportedOutcome(stdout: string): string | null {
  const lines = stdout.split("\n").filter((line) => line.startsWith("OUTCOME "));
  const last = lines.at(-1);
  return last === undefined ? null : last.slice("OUTCOME ".length).trim();
}

export class ScriptedAgentAdapter implements AgentAdapter {
  readonly id = "scripted";
  private readonly plan: AgentScript[];

  constructor(
    plan: readonly AgentScript[],
    private readonly options: ScriptedOptions = {},
  ) {
    this.plan = [...plan];
  }

  start(input: AgentInput): AgentHandle {
    const script = this.plan.shift() ?? { mode: "report", outcome: "complete" };
    const launched = this.options.binary !== undefined;
    const running = startProcess({
      command: launched ? (this.options.binary as string) : process.execPath,
      args: launched
        ? []
        : [FAKE_AGENT, script.mode, script.outcome ?? "complete", script.extra ?? ""],
      cwd: input.cwd,
      env: childEnvironment(
        this.options.logFile === undefined ? {} : { FAKE_AGENT_LOG: this.options.logFile },
      ),
      timeoutMs: input.timeoutMs,
      logPath: input.logPath,
    });
    return {
      pid: running.pid,
      completed: running.completed.then(toAgentResult),
      terminate: running.terminate,
    };
  }
}

function toAgentResult(result: ProcessResult): AgentRunResult {
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    terminated: result.terminated,
    spawnError: result.spawnError,
    reportedOutcome: reportedOutcome(result.stdout),
    stdout: result.stdout,
  };
}
