/**
 * A scripted agent adapter for tests. It launches test/fixtures/fake-agent.mjs, one script per
 * attempt, in the order the plan lists them. It shares the process supervisor with real adapters,
 * so every behavior tested here runs through the same code path a harness would.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  type AgentAdapter,
  type AgentHandle,
  type AgentInput,
  type AgentRunResult,
  ResumeUnavailableError,
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
  | "hang-with-child"
  | "duplicate"
  | "invalid-then-valid"
  | "report-then-delay"
  | "report-then-hang"
  | "leak-token"
  | "provider-error";

export interface AgentScript {
  readonly mode: AgentMode;
  readonly outcome?: string;
  readonly extra?: string;
}

export interface ScriptedOptions {
  /** Replaces the fake agent with this executable, to test a harness that cannot be started. */
  readonly binary?: string;
  readonly logFile?: string;
  readonly supportsResume?: boolean;
  readonly missingSession?: boolean;
  readonly resumeError?: boolean;
}

export const FAKE_AGENT = path.join(REPO_ROOT, "test", "fixtures", "fake-agent.mjs");

export const SCRIPTED_CAPABILITIES = Object.freeze({
  supportsResume: true,
  supportsModelSelection: true,
  supportsReasoningEffort: true,
  supportsEventStream: false,
  supportsStructuredFinalOutput: false,
  supportsPermissionMode: false,
});

export class ScriptedAgentAdapter implements AgentAdapter {
  readonly id = "scripted";
  readonly capabilities;
  private readonly plan: AgentScript[];

  constructor(
    plan: readonly AgentScript[],
    private readonly options: ScriptedOptions = {},
  ) {
    this.plan = [...plan];
    this.capabilities = Object.freeze({
      ...SCRIPTED_CAPABILITIES,
      supportsResume: options.supportsResume !== false,
    });
    this.resumeForReportCorrection =
      options.supportsResume === false ? undefined : (input) => this.launch(input, true);
  }

  readonly resumeForReportCorrection:
    | ((input: AgentInput & { readonly priorSessionId: string }) => AgentHandle)
    | undefined;

  start(input: AgentInput): AgentHandle {
    return this.launch(input, false);
  }

  private launch(input: AgentInput, correction: boolean): AgentHandle {
    if (correction && this.options.resumeError)
      throw new Error("persisted fake session cannot be resumed");
    if (
      input.priorSessionId &&
      (!existsSync(input.priorSessionId) || this.options.supportsResume === false)
    )
      throw new ResumeUnavailableError();
    const script =
      this.plan.shift() ??
      (correction ? { mode: "silent" } : { mode: "report", outcome: "complete" });
    const sessionId = this.options.missingSession
      ? undefined
      : (input.priorSessionId ??
        path.join(
          path.dirname(input.logPath ?? path.join(input.cwd, "agent.log")),
          `session-${randomUUID()}.json`,
        ));
    const launched = this.options.binary !== undefined;
    const running = startProcess({
      command: launched ? (this.options.binary as string) : process.execPath,
      args: launched
        ? []
        : [FAKE_AGENT, script.mode, script.outcome ?? "complete", script.extra ?? ""],
      cwd: input.cwd,
      env: childEnvironment({
        ...(this.options.logFile === undefined ? {} : { FAKE_AGENT_LOG: this.options.logFile }),
        ...(sessionId === undefined ? {} : { FAKE_SESSION: sessionId }),
        FAKE_RESUME: input.priorSessionId ? "1" : "0",
        FAKE_CORRECTION: correction ? "1" : "0",
        FAKE_PROMPT: input.prompt,
        PATH: `${path.join(REPO_ROOT, "bin")}:${process.env["PATH"] ?? ""}`,
        ...(input.reportAccess
          ? {
              WF_REPORT_ENDPOINT: input.reportAccess.endpoint,
              WF_REPORT_TOKEN: input.reportAccess.token,
            }
          : {}),
      }),
      timeoutMs: input.timeoutMs,
      logPath: input.logPath,
      secrets: input.reportAccess ? [input.reportAccess.token] : [],
    });
    return {
      pid: running.pid,
      sessionId,
      completed: running.completed.then((result) => ({
        ...toAgentResult(result),
        sessionId,
        ...(script.mode === "provider-error" ? { providerError: "offline provider failed" } : {}),
      })),
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
    stdout: result.stdout,
  };
}
