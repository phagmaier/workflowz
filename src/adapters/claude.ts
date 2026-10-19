/** Claude Code print adapter. Terminal evidence never substitutes for supervised process settlement. */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AgentAdapter,
  type AgentHandle,
  type AgentInput,
  ResumeUnavailableError,
} from "./agent-adapter.js";
import { ClaudeEvents, isClaudeSessionId } from "./claude-events.js";
import { childEnvironment } from "./environment.js";
import { type CommandRunner, probeEnvironment, runProbeCommand } from "./probe.js";
import { startProcess } from "./process.js";

export interface ClaudeAdapterOptions {
  readonly binary?: string;
  /** Explicit wrapper argv, including the offline fixture CLI in conformance tests. */
  readonly prefixArgs?: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly wfBinDir?: string;
}
export interface ClaudeCompatibility {
  readonly version: string;
  readonly supportsResume: boolean;
}

const WF_BIN = fileURLToPath(new URL("../../bin", import.meta.url));
const CLAUDE_ENV_NAMES = [
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
] as const;
const EFFORT = new Set(["low", "medium", "high", "xhigh", "max"]);

/** Offline help/version probes use temporary config/home, without provider credentials. */
export async function createClaudeAdapter(
  options: ClaudeAdapterOptions = {},
  run?: CommandRunner,
): Promise<ClaudeAdapter> {
  const directory = mkdtempSync(path.join(os.tmpdir(), "wf-claude-probe-"));
  try {
    const command =
      run ??
      ((binary, args) =>
        runProbeCommand(binary, args, {
          ...probeEnvironment(options.environment),
          HOME: directory,
          CLAUDE_CONFIG_DIR: directory,
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        }));
    const checked = async (args: string[]) => {
      const result = await command(options.binary ?? "claude", [
        ...(options.prefixArgs ?? []),
        ...args,
      ]);
      if (result.spawnError || result.exitCode !== 0)
        throw new Error(
          `Claude compatibility probe failed (${args.join(" ")}): ${result.spawnError ?? `exit ${result.exitCode}`}`,
        );
      return result.stdout;
    };
    const version = (await checked(["--version"])).trim();
    if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)? \(Claude Code\)$/.test(version))
      throw new Error("Claude compatibility probe returned an unrecognized version");
    const help = await checked(["--help"]);
    const advertised = (flag: string) => new RegExp(`(?:^|\\s)${flag}(?:\\s|[=<,])`).test(help);
    const missing = [
      "--print",
      "--input-format",
      "--output-format",
      "--verbose",
      "--permission-mode",
      "--model",
      "--effort",
    ].filter((flag) => !advertised(flag));
    for (const marker of ["stream-json", "bypassPermissions", ...EFFORT])
      if (!help.includes(marker)) missing.push(marker);
    if (missing.length)
      throw new Error(
        `Claude print mode is incompatible; help does not advertise ${missing.join(", ")}`,
      );
    return new ClaudeAdapter(options, { version, supportsResume: advertised("--resume") });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export class ClaudeAdapter implements AgentAdapter {
  readonly id = "claude";
  readonly resumeForReportCorrection: AgentAdapter["resumeForReportCorrection"];
  constructor(
    private readonly options: ClaudeAdapterOptions,
    readonly compatibility: ClaudeCompatibility,
  ) {
    this.resumeForReportCorrection = compatibility.supportsResume
      ? (input) => this.start(input)
      : undefined;
  }

  start(input: AgentInput): AgentHandle {
    const prior = input.priorSessionId;
    if (prior !== undefined && (!this.compatibility.supportsResume || !isClaudeSessionId(prior)))
      throw new ResumeUnavailableError();
    if (!input.reportAccess) throw new Error("Claude requires the runner's report channel");
    if (input.reasoningEffort !== undefined && !EFFORT.has(input.reasoningEffort))
      throw new Error("Claude effort must be low, medium, high, xhigh, or max");
    const source = this.options.environment ?? process.env;
    const extra: Record<string, string> = {};
    for (const name of CLAUDE_ENV_NAMES) if (source[name] !== undefined) extra[name] = source[name];
    const env = childEnvironment(
      {
        ...extra,
        PATH: `${path.resolve(this.options.wfBinDir ?? WF_BIN)}${path.delimiter}${source.PATH ?? ""}`,
        WF_REPORT_ENDPOINT: input.reportAccess.endpoint,
        WF_REPORT_TOKEN: input.reportAccess.token,
      },
      source,
    );
    const events = new ClaudeEvents();
    const running = startProcess({
      command: this.options.binary ?? "claude",
      args: [
        ...(this.options.prefixArgs ?? []),
        "--print",
        "--input-format",
        "text",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
        ...(prior === undefined ? [] : ["--resume", prior]),
        ...(input.model === undefined ? [] : ["--model", input.model]),
        ...(input.reasoningEffort === undefined ? [] : ["--effort", input.reasoningEffort]),
      ],
      cwd: input.cwd,
      env,
      stdin: input.prompt,
      timeoutMs: input.timeoutMs,
      logPath: input.logPath,
      secrets: [
        input.reportAccess.token,
        ...Object.entries(extra)
          .filter(([name]) => /KEY|TOKEN/.test(name))
          .map(([, value]) => value),
      ],
      onStdout: (chunk) => events.push(chunk),
    });
    return {
      pid: running.pid,
      sessionId: prior,
      launchInfo: {
        harnessVersion: this.compatibility.version,
        permissionMode: "bypassPermissions",
      },
      terminate: running.terminate,
      completed: running.completed.then((result) => {
        events.end();
        const uninterrupted =
          !result.signal && !result.spawnError && !result.timedOut && !result.terminated;
        const clean = result.exitCode === 0 && uninterrupted;
        const wrongSession = prior !== undefined && events.sessionId !== prior;
        return {
          exitCode: result.exitCode,
          signal: result.signal,
          timedOut: result.timedOut,
          terminated: result.terminated,
          spawnError: result.spawnError,
          // No mismatched identity can replace the requested durable session, even on provider failure.
          sessionId: prior ?? events.sessionId,
          stdout: result.stdout,
          ...(uninterrupted &&
          prior !== undefined &&
          ((clean && wrongSession) || (events.resumeUnavailable && events.sessionId === prior))
            ? { resumeUnavailable: true }
            : {}),
          ...(clean && (!events.successful || result.stdinError)
            ? { providerError: "Claude event stream did not confirm a successful terminal result" }
            : {}),
        };
      }),
    };
  }
}
