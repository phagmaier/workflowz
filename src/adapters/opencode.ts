/** OpenCode v2 uses a private leased API server: CLI run can silently create a missing resume ID. */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AdapterCompatibility,
  AdapterPreflightError,
  type AgentAdapter,
  type AgentHandle,
  type AgentInput,
  assertAdapterCapabilities,
  ResumeUnavailableError,
} from "./agent-adapter.js";
import type { HarnessCapabilities } from "./harness-registry.js";
import { openCodeEnvironment } from "./opencode-environment.js";
import { isOpenCodeSessionId, OpenCodeEvents } from "./opencode-events.js";
import {
  CapabilityProbeError,
  type CommandRunner,
  helpAdvertises,
  probeEnvironment,
  probeText,
  runProbeCommand,
} from "./probe.js";
import { processDiagnostics, startProcess } from "./process.js";
import { environmentSecrets } from "./secrets.js";

export interface OpenCodeAdapterOptions {
  readonly binary?: string;
  readonly prefixArgs?: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly wfBinDir?: string;
}
export interface OpenCodeCompatibility extends AdapterCompatibility {}
const WF_BIN = fileURLToPath(new URL("../../bin", import.meta.url));
const BRIDGE = fileURLToPath(new URL("./opencode-bridge.js", import.meta.url));
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
      return probeText(result, "OpenCode", args);
    };
    const version = (await checked(["--version"])).trim();
    if (!/^opencode v2\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version))
      throw new CapabilityProbeError("OpenCode compatibility probe requires the v2 API");
    const serve = await checked(["serve", "--help"]);
    const optionalHelp = async (args: string[]) => {
      const result = await command(options.binary ?? "opencode", [
        ...(options.prefixArgs ?? []),
        ...args,
      ]);
      return !result.spawnError && result.exitCode === 0 ? result.stdout : "";
    };
    const help = await optionalHelp(["run", "--help"]);
    const missing = ["--stdio", "--hostname", "--port"].filter(
      (flag) => !helpAdvertises(serve, flag),
    );
    if (missing.length)
      throw new CapabilityProbeError(
        `OpenCode private API mode is incompatible; help does not advertise ${missing.join(", ")}`,
        missing,
      );
    const sessions = await optionalHelp(["session", "--help"]);
    return new OpenCodeAdapter(options, {
      version,
      supportsResume: /\bexport\b/.test(sessions),
      supportsModelSelection: helpAdvertises(help, "--model"),
      supportsReasoningEffort:
        helpAdvertises(help, "--model") && help.includes("provider/model#variant"),
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export class OpenCodeAdapter implements AgentAdapter {
  readonly id = "opencode";
  readonly capabilities: HarnessCapabilities;
  readonly resumeForReportCorrection: AgentAdapter["resumeForReportCorrection"];
  constructor(
    private readonly options: OpenCodeAdapterOptions,
    readonly compatibility: OpenCodeCompatibility,
  ) {
    this.capabilities = Object.freeze({
      supportsResume: compatibility.supportsResume,
      supportsModelSelection: compatibility.supportsModelSelection,
      supportsReasoningEffort: compatibility.supportsReasoningEffort,
      supportsEventStream: false,
      supportsPermissionMode: true,
      supportsStructuredFinalOutput: false,
    });
    this.resumeForReportCorrection = compatibility.supportsResume
      ? (input) => this.start(input)
      : undefined;
  }
  start(input: AgentInput): AgentHandle {
    assertAdapterCapabilities(this, input);
    const prior = input.priorSessionId;
    if (prior !== undefined && (!this.compatibility.supportsResume || !isOpenCodeSessionId(prior)))
      throw new ResumeUnavailableError();
    if (!input.reportAccess) throw new Error("OpenCode requires the runner's report channel");
    // OpenCode v2 selects reasoning through the model's named variant, not a separate effort flag.
    const match = input.model?.match(/^([^/\s#]+)\/([^\s#]+)(?:#([^\s#]+))?$/);
    if (input.model !== undefined && !match)
      throw new AdapterPreflightError(
        "OpenCode model must be provider/model#variant (variant optional)",
      );
    if (match?.[3] !== undefined && !this.capabilities.supportsReasoningEffort)
      throw new AdapterPreflightError(
        "OpenCode installed model mode does not support named reasoning variants",
      );
    if (
      input.reasoningEffort !== undefined &&
      (!match || !/^[A-Za-z0-9_-]+$/.test(input.reasoningEffort) || match[3] !== undefined)
    )
      throw new AdapterPreflightError(
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

    const password = randomBytes(32).toString("base64url");
    const events = new OpenCodeEvents();
    const env = openCodeEnvironment(source, {
      PATH: `${path.resolve(this.options.wfBinDir ?? WF_BIN)}${path.delimiter}${source.PATH ?? ""}`,
      WF_REPORT_ENDPOINT: input.reportAccess.endpoint,
      WF_REPORT_TOKEN: input.reportAccess.token,
    });
    const secrets = [
      ...(input.reportAccess.secrets ?? [input.reportAccess.token]),
      password,
      Buffer.from(`opencode:${password}`).toString("base64"),
      ...environmentSecrets(env),
    ];
    const running = startProcess({
      command: process.execPath,
      args: [BRIDGE],
      cwd: input.cwd,
      env,
      stdin: JSON.stringify({
        binary: this.options.binary ?? "opencode",
        args: this.options.prefixArgs ?? [],
        password,
        secrets: input.reportAccess.secrets ?? [input.reportAccess.token],
        prompt: input.prompt,
        ...(prior === undefined ? {} : { prior }),
        ...(model === undefined ? {} : { model }),
      }),
      timeoutMs: input.timeoutMs,
      logPath: input.logPath,
      secrets,
      onStdout: (chunk) => events.push(chunk),
    });
    return {
      pid: running.pid,
      secrets,
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
          diagnostics: processDiagnostics(result),
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
