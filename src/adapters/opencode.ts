/** OpenCode v2 uses a private leased API server: CLI run can silently create a missing resume ID. */
import { randomBytes } from "node:crypto";
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
import { childEnvironment } from "./environment.js";
import { isOpenCodeSessionId, OpenCodeEvents } from "./opencode-events.js";
import { type CommandRunner, probeEnvironment, runProbeCommand } from "./probe.js";
import { startProcess } from "./process.js";

export interface OpenCodeAdapterOptions {
  readonly binary?: string;
  readonly prefixArgs?: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly wfBinDir?: string;
}
export interface OpenCodeCompatibility {
  readonly version: string;
  readonly supportsResume: boolean;
}
const WF_BIN = fileURLToPath(new URL("../../bin", import.meta.url));
const BRIDGE = fileURLToPath(new URL("./opencode-bridge.js", import.meta.url));
const ENV_NAMES = [
  "XDG_CACHE_HOME",
  "OPENCODE_CONFIG_DIR",
  "OPENCODE_CONFIG",
  "OPENCODE_DB",
  "OPENCODE_DISABLE_MODELS_FETCH",
  "OPENCODE_MODELS_PATH",
  "OPENCODE_CONFIG_PROJECT_DISABLE",
  "OPENCODE_DISABLE_CLAUDE_CODE",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

/** Offline help/version only, isolated from user config/auth and the shared service. */
export async function createOpenCodeAdapter(
  options: OpenCodeAdapterOptions = {},
  run?: CommandRunner,
): Promise<OpenCodeAdapter> {
  const directory = mkdtempSync(path.join(os.tmpdir(), "wf-opencode-probe-"));
  try {
    const command =
      run ??
      ((binary, args) =>
        runProbeCommand(binary, args, {
          ...probeEnvironment(options.environment),
          HOME: directory,
          XDG_CONFIG_HOME: path.join(directory, "config"),
          XDG_DATA_HOME: path.join(directory, "data"),
          XDG_STATE_HOME: path.join(directory, "state"),
          XDG_CACHE_HOME: path.join(directory, "cache"),
          OPENCODE_CONFIG_DIR: path.join(directory, "config"),
          OPENCODE_DISABLE_MODELS_FETCH: "1",
        }));
    const checked = async (args: string[]) => {
      const result = await command(options.binary ?? "opencode", [
        ...(options.prefixArgs ?? []),
        ...args,
      ]);
      if (result.spawnError || result.exitCode !== 0)
        throw new Error(
          `OpenCode compatibility probe failed (${args.join(" ")}): ${result.spawnError ?? `exit ${result.exitCode}`}`,
        );
      return result.stdout;
    };
    const version = (await checked(["--version"])).trim();
    if (!/^opencode v2\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version))
      throw new Error("OpenCode compatibility probe requires the v2 API");
    const serve = await checked(["serve", "--help"]);
    const help = await checked(["run", "--help"]);
    const missing = ["--stdio", "--hostname", "--port"].filter((flag) => !serve.includes(flag));
    for (const marker of ["--model", "provider/model#variant"])
      if (!help.includes(marker)) missing.push(marker);
    if (missing.length)
      throw new Error(
        `OpenCode private API mode is incompatible; help does not advertise ${missing.join(", ")}`,
      );
    const sessions = await checked(["session", "--help"]);
    return new OpenCodeAdapter(options, { version, supportsResume: /\bexport\b/.test(sessions) });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export class OpenCodeAdapter implements AgentAdapter {
  readonly id = "opencode";
  readonly resumeForReportCorrection: AgentAdapter["resumeForReportCorrection"];
  constructor(
    private readonly options: OpenCodeAdapterOptions,
    readonly compatibility: OpenCodeCompatibility,
  ) {
    this.resumeForReportCorrection = compatibility.supportsResume
      ? (input) => this.start(input)
      : undefined;
  }
  start(input: AgentInput): AgentHandle {
    const prior = input.priorSessionId;
    if (prior !== undefined && (!this.compatibility.supportsResume || !isOpenCodeSessionId(prior)))
      throw new ResumeUnavailableError();
    if (!input.reportAccess) throw new Error("OpenCode requires the runner's report channel");
    // OpenCode v2 selects reasoning through the model's named variant, not a separate effort flag.
    const match = input.model?.match(/^([^/\s#]+)\/([^\s#]+)(?:#([^\s#]+))?$/);
    if (input.model !== undefined && !match)
      throw new Error("OpenCode model must be provider/model#variant (variant optional)");
    if (
      input.reasoningEffort !== undefined &&
      (!match || !/^[A-Za-z0-9_-]+$/.test(input.reasoningEffort) || match[3] !== undefined)
    )
      throw new Error(
        "OpenCode reasoning effort requires an explicit provider/model without an existing variant",
      );
    const model = match
      ? {
          providerID: match[1],
          id: match[2],
          ...((input.reasoningEffort ?? match[3])
            ? { variant: input.reasoningEffort ?? match[3] }
            : {}),
        }
      : undefined;
    const source = this.options.environment ?? process.env;
    const extra: Record<string, string> = {};
    for (const name of ENV_NAMES) if (source[name] !== undefined) extra[name] = source[name];
    const password = randomBytes(32).toString("base64url");
    const events = new OpenCodeEvents();
    const running = startProcess({
      command: process.execPath,
      args: [BRIDGE],
      cwd: input.cwd,
      env: childEnvironment(
        {
          ...extra,
          PATH: `${path.resolve(this.options.wfBinDir ?? WF_BIN)}${path.delimiter}${source.PATH ?? ""}`,
          WF_REPORT_ENDPOINT: input.reportAccess.endpoint,
          WF_REPORT_TOKEN: input.reportAccess.token,
        },
        source,
      ),
      stdin: JSON.stringify({
        binary: this.options.binary ?? "opencode",
        args: this.options.prefixArgs ?? [],
        password,
        prompt: input.prompt,
        ...(prior === undefined ? {} : { prior }),
        ...(model === undefined ? {} : { model }),
      }),
      timeoutMs: input.timeoutMs,
      logPath: input.logPath,
      secrets: [
        input.reportAccess.token,
        password,
        Buffer.from(`opencode:${password}`).toString("base64"),
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
        permissionMode: "session-allow-all",
      },
      terminate: running.terminate,
      completed: running.completed.then((result) => {
        events.end();
        const uninterrupted =
          !result.signal && !result.spawnError && !result.timedOut && !result.terminated;
        const clean = result.exitCode === 0 && uninterrupted;
        return {
          exitCode: result.exitCode,
          signal: result.signal,
          timedOut: result.timedOut,
          terminated: result.terminated,
          spawnError: result.spawnError ?? (uninterrupted ? (events.spawnError ?? null) : null),
          sessionId: prior ?? events.sessionId,
          stdout: result.stdout,
          ...(uninterrupted &&
          prior !== undefined &&
          (events.resumeUnavailable || (clean && events.sessionId !== prior))
            ? { resumeUnavailable: true }
            : {}),
          ...(clean && (!events.successful || result.stdinError)
            ? { providerError: "OpenCode API did not confirm a successful terminal execution" }
            : {}),
        };
      }),
    };
  }
}
