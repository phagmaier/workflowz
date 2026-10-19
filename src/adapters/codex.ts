/** Codex exec adapter. CLI evidence gates construction; only supervised process exit settles a turn. */
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
import { CodexEvents, isCodexSessionId } from "./codex-events.js";
import { childEnvironment } from "./environment.js";
import type { HarnessCapabilities } from "./harness-registry.js";
import {
  CapabilityProbeError,
  type CommandRunner,
  helpAdvertises,
  probeEnvironment,
  probeText,
  runProbeCommand,
} from "./probe.js";
import { startProcess } from "./process.js";

export interface CodexAdapterOptions {
  readonly binary?: string;
  /** Explicit wrapper argv; also lets offline conformance run the real adapter against a fixture CLI. */
  readonly prefixArgs?: readonly string[];
  /** Source of inherited values; only the common allowlist and Codex-specific names are selected. */
  readonly environment?: NodeJS.ProcessEnv;
  readonly wfBinDir?: string;
}

export interface CodexCompatibility extends AdapterCompatibility {
  readonly resumeSupportsModelSelection: boolean;
}

const COMMON_MARKERS = [
  "--json",
  "--config",
  "--skip-git-repo-check",
  "--dangerously-bypass-approvals-and-sandbox",
  "stdin",
];
const WF_BIN = fileURLToPath(new URL("../../bin", import.meta.url));

/** Offline only: version/help markers are compatibility evidence, not proof of authentication or live framing. */
export async function createCodexAdapter(
  options: CodexAdapterOptions = {},
  run?: CommandRunner,
): Promise<CodexAdapter> {
  const directory = mkdtempSync(path.join(os.tmpdir(), "wf-codex-probe-"));
  try {
    const command =
      run ??
      ((binary, args) =>
        runProbeCommand(binary, args, {
          ...probeEnvironment(options.environment),
          HOME: directory,
          CODEX_HOME: directory,
        }));
    const binary = options.binary ?? "codex";
    const prefix = options.prefixArgs ?? [];
    const checked = async (args: string[]) => {
      const result = await command(binary, [...prefix, ...args]);
      return probeText(result, "Codex", args);
    };
    const version = (await checked(["--version"])).trim();
    if (!/^codex-cli \d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version))
      throw new CapabilityProbeError("Codex compatibility probe returned an unrecognized version");
    const help = await checked(["exec", "--help"]);
    const missing = COMMON_MARKERS.filter(
      (marker) => !(marker.startsWith("--") ? helpAdvertises(help, marker) : help.includes(marker)),
    );
    if (missing.length)
      throw new CapabilityProbeError(
        `Codex exec is incompatible; help does not advertise ${missing.join(", ")}`,
        missing,
      );
    const resume = await command(binary, [...prefix, "exec", "resume", "--help"]);
    const supportsResume =
      !resume.spawnError &&
      resume.exitCode === 0 &&
      [...COMMON_MARKERS, "SESSION_ID"].every((marker) =>
        marker.startsWith("--")
          ? helpAdvertises(resume.stdout, marker)
          : resume.stdout.includes(marker),
      );
    return new CodexAdapter(options, {
      version,
      supportsResume,
      supportsModelSelection: helpAdvertises(help, "--model"),
      supportsReasoningEffort: true,
      resumeSupportsModelSelection: supportsResume && helpAdvertises(resume.stdout, "--model"),
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export class CodexAdapter implements AgentAdapter {
  readonly id = "codex";
  readonly capabilities: HarnessCapabilities;
  readonly resumeForReportCorrection: AgentAdapter["resumeForReportCorrection"];
  constructor(
    private readonly options: CodexAdapterOptions,
    readonly compatibility: CodexCompatibility,
  ) {
    this.capabilities = Object.freeze({
      supportsResume: compatibility.supportsResume,
      supportsModelSelection: compatibility.supportsModelSelection,
      supportsReasoningEffort: compatibility.supportsReasoningEffort,
      supportsEventStream: true,
      supportsPermissionMode: true,
      supportsStructuredFinalOutput: false,
    });
    this.resumeForReportCorrection = compatibility.supportsResume
      ? (input) => this.start(input)
      : undefined;
  }

  start(input: AgentInput): AgentHandle {
    assertAdapterCapabilities(this, input);
    if (
      input.priorSessionId !== undefined &&
      (!this.compatibility.supportsResume || !isCodexSessionId(input.priorSessionId))
    )
      throw new ResumeUnavailableError();
    if (
      input.priorSessionId !== undefined &&
      input.model !== undefined &&
      !this.compatibility.resumeSupportsModelSelection
    )
      throw new AdapterPreflightError(
        "Codex installed resume mode does not support model selection",
      );
    if (!input.reportAccess) throw new Error("Codex requires the runner's report channel");
    const source = this.options.environment ?? process.env;
    const extra: Record<string, string> = {};
    for (const name of ["CODEX_HOME", "CODEX_API_KEY"] as const)
      if (source[name] !== undefined) extra[name] = source[name];
    const env = childEnvironment(
      {
        ...extra,
        PATH: `${path.resolve(this.options.wfBinDir ?? WF_BIN)}${path.delimiter}${source.PATH ?? ""}`,
        WF_REPORT_ENDPOINT: input.reportAccess.endpoint,
        WF_REPORT_TOKEN: input.reportAccess.token,
      },
      source,
    );
    const args = [
      ...(this.options.prefixArgs ?? []),
      "exec",
      ...(input.priorSessionId ? ["resume"] : []),
      "--json",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "-c",
      "features.shell_snapshot=false",
      // Replace this invocation's tool env policy; no token/key is placed in argv or a config file.
      "-c",
      'shell_environment_policy={inherit="all",ignore_default_excludes=true,exclude=["CODEX_API_KEY"],include_only=[]}',
      ...(input.model === undefined ? [] : ["--model", input.model]),
      ...(input.reasoningEffort === undefined
        ? []
        : ["-c", `model_reasoning_effort=${JSON.stringify(input.reasoningEffort)}`]),
      ...(input.priorSessionId ? [input.priorSessionId] : []),
      "-",
    ];
    const events = new CodexEvents();
    const running = startProcess({
      command: this.options.binary ?? "codex",
      args,
      cwd: input.cwd,
      env,
      stdin: input.prompt,
      timeoutMs: input.timeoutMs,
      logPath: input.logPath,
      secrets: [input.reportAccess.token, ...(extra.CODEX_API_KEY ? [extra.CODEX_API_KEY] : [])],
      onStdout: (chunk) => events.push(chunk),
    });
    return {
      pid: running.pid,
      sessionId: input.priorSessionId,
      launchInfo: {
        harnessVersion: this.compatibility.version,
        permissionMode: "dangerously-bypass-approvals-and-sandbox",
      },
      completed: running.completed.then((result) => {
        events.end();
        const clean =
          result.exitCode === 0 &&
          !result.signal &&
          !result.spawnError &&
          !result.timedOut &&
          !result.terminated;
        const wrongSession =
          input.priorSessionId !== undefined && events.sessionId !== input.priorSessionId;
        return {
          exitCode: result.exitCode,
          signal: result.signal,
          timedOut: result.timedOut,
          terminated: result.terminated,
          spawnError: result.spawnError,
          // Never make an unexpected fresh identity eligible for a later workflow resume.
          sessionId: wrongSession ? input.priorSessionId : events.sessionId,
          ...(clean && wrongSession ? { resumeUnavailable: true } : {}),
          ...(clean && (!events.successful || result.stdinError)
            ? { providerError: "Codex event stream did not confirm a successful turn" }
            : {}),
          stdout: result.stdout,
        };
      }),
      terminate: running.terminate,
    };
  }
}
