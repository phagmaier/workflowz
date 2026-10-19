/** One-shot Pi-family JSON adapter; CLI dialects differ, common process/report ownership does not. */
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
} from "node:fs";
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
import { readOmpSession } from "./omp-session.js";
import { isPiSessionHeader, PiEvents, type PiSessionHeader } from "./pi-events.js";
import { type CommandRunner, probeEnvironment, runProbeCommand } from "./probe.js";
import { startProcess } from "./process.js";

export interface PiAdapterOptions {
  readonly binary?: string;
  readonly prefixArgs?: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly wfBinDir?: string;
  /** Persistent session root. Defaults to <harness>-sessions beside the invocation log. */
  readonly sessionDir?: string;
}
export interface PiCompatibility {
  readonly version: string;
  readonly supportsResume: boolean;
}

const WF_BIN = fileURLToPath(new URL("../../bin", import.meta.url));
// Deliberate provider selection, not all runner credentials. Other providers can use Pi's auth store.
const PI_ENV_NAMES = [
  "PI_CODING_AGENT_DIR",
  "PI_OFFLINE",
  "PI_TELEMETRY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_OAUTH_TOKEN",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
] as const;
const OMP_ENV_NAMES = [
  "PI_CODING_AGENT_DIR",
  "PI_CONFIG_DIR",
  "OMP_PROFILE",
  "PI_NO_TITLE",
  "OPENAI_API_KEY",
  "OPENAI_CODEX_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_OAUTH_TOKEN",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "OMP_AUTH_BROKER_URL",
  "OMP_AUTH_BROKER_TOKEN",
] as const;
const THINKING = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** Isolated offline probes do not load the user's resources/authentication or change global settings. */
export async function createPiAdapter(
  options: PiAdapterOptions = {},
  run?: CommandRunner,
): Promise<PiAdapter> {
  const probeDir = mkdtempSync(path.join(os.tmpdir(), "wf-pi-probe-"));
  try {
    const command =
      run ??
      ((binary, args) =>
        runProbeCommand(binary, args, {
          ...probeEnvironment(options.environment),
          PI_CODING_AGENT_DIR: probeDir,
          PI_OFFLINE: "1",
          PI_TELEMETRY: "0",
        }));
    const checked = async (args: string[]) => {
      const result = await command(options.binary ?? "pi", [
        ...(options.prefixArgs ?? []),
        ...args,
      ]);
      if (result.spawnError || result.exitCode !== 0)
        throw new Error(
          `Pi compatibility probe failed (${args.join(" ")}): ${result.spawnError ?? `exit ${result.exitCode}`}`,
        );
      return result.stdout;
    };
    const version = (await checked(["--version"])).trim();
    if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version))
      throw new Error("Pi compatibility probe returned an unrecognized version");
    const help = await checked([
      "--offline",
      "--no-extensions",
      "--no-mcp",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "--help",
    ]);
    const advertised = (flag: string) => new RegExp(`(?:^|\\s)${flag}(?:\\s|[=<,])`).test(help);
    const missing = ["--print", "--mode", "--model", "--thinking", "--session-dir"].filter(
      (flag) => !advertised(flag),
    );
    if (missing.length || !/\bjson\b/.test(help))
      throw new Error(
        `Pi JSON mode is incompatible; help does not advertise ${missing.join(", ") || "json"}`,
      );
    return new PiAdapter(options, { version, supportsResume: advertised("--session") });
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

export class PiAdapter implements AgentAdapter {
  readonly resumeForReportCorrection: AgentAdapter["resumeForReportCorrection"];
  constructor(
    private readonly options: PiAdapterOptions,
    readonly compatibility: PiCompatibility,
    readonly id: "pi" | "omp" = "pi",
  ) {
    this.resumeForReportCorrection = compatibility.supportsResume
      ? (input) => this.start(input)
      : undefined;
  }

  start(input: AgentInput): AgentHandle {
    const prior = input.priorSessionId;
    const readSession = this.id === "omp" ? readOmpSession : readHeader;
    const header = prior === undefined ? undefined : readSession(prior);
    // Pi needs UUID lookup to avoid missing-path creation. omp's strict path branch throws if
    // missing; ID lookup instead permits prefixes/global search and a create-on-delete race.
    if (
      prior !== undefined &&
      (!this.compatibility.supportsResume ||
        !header ||
        path.resolve(header.cwd) !== path.resolve(input.cwd))
    )
      throw new ResumeUnavailableError();
    if (!input.reportAccess) throw new Error(`${this.id} requires the runner's report channel`);
    if (
      input.reasoningEffort !== undefined &&
      !THINKING.has(input.reasoningEffort) &&
      !(this.id === "omp" && input.reasoningEffort === "auto")
    )
      throw new Error(`${this.id} thinking level is unsupported`);
    const root =
      this.options.sessionDir ??
      (input.logPath ? path.join(path.dirname(input.logPath), `${this.id}-sessions`) : undefined);
    let sessionDir: string;
    if (prior) sessionDir = path.dirname(prior);
    else {
      if (!root)
        throw new Error(`${this.id} requires sessionDir or logPath for persistent sessions`);
      mkdirSync(path.resolve(root), { recursive: true });
      sessionDir = mkdtempSync(path.join(path.resolve(root), "session-"));
    }
    const source = this.options.environment ?? process.env;
    const extra: Record<string, string> = {};
    for (const name of this.id === "omp" ? OMP_ENV_NAMES : PI_ENV_NAMES)
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
    const events = new PiEvents(this.id);
    const running = startProcess({
      command: this.options.binary ?? this.id,
      args: [
        ...(this.options.prefixArgs ?? []),
        "--print",
        "--mode",
        "json",
        "--session-dir",
        sessionDir,
        ...(this.id === "omp" ? ["--approval-mode", "yolo"] : []),
        ...(header
          ? this.id === "omp"
            ? ["--resume", prior as string]
            : ["--session", header.id]
          : []),
        ...(input.model === undefined ? [] : ["--model", input.model]),
        ...(input.reasoningEffort === undefined ? [] : ["--thinking", input.reasoningEffort]),
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
        permissionMode: this.id === "omp" ? "yolo" : "default-unrestricted-tools",
      },
      terminate: running.terminate,
      completed: running.completed.then((result) => {
        events.end();
        const clean =
          result.exitCode === 0 &&
          !result.signal &&
          !result.spawnError &&
          !result.timedOut &&
          !result.terminated;
        const stored = prior === undefined ? undefined : readSession(prior);
        const wrongSession =
          prior !== undefined &&
          (events.session?.id !== header?.id ||
            events.session?.cwd !== header?.cwd ||
            stored?.id !== header?.id ||
            stored?.cwd !== header?.cwd);
        const sessionId = prior ?? persistedSession(sessionDir, events.session, readSession);
        return {
          exitCode: result.exitCode,
          signal: result.signal,
          timedOut: result.timedOut,
          terminated: result.terminated,
          spawnError: result.spawnError,
          sessionId,
          stdout: result.stdout,
          ...(clean && wrongSession ? { resumeUnavailable: true } : {}),
          ...(clean &&
          (!events.successful ||
            result.stdinError ||
            (this.id === "omp" &&
              events.session !== undefined &&
              path.resolve(events.session.cwd) !== path.resolve(input.cwd)))
            ? {
                providerError: `${this.id} event stream did not confirm a successful completed run`,
              }
            : {}),
        };
      }),
    };
  }
}

/** Only runner-created UUID files qualify. Bounded header reads never load transcripts or auth files. */
function readHeader(file: string): PiSessionHeader | undefined {
  if (!path.isAbsolute(file) || !file.endsWith(".jsonl")) return undefined;
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const bytes = Buffer.alloc(16384);
    const count = readSync(fd, bytes, 0, bytes.length, 0);
    const lf = bytes.subarray(0, count).indexOf(10);
    if (lf < 0) return undefined;
    const header: unknown = JSON.parse(bytes.subarray(0, lf).toString("utf8"));
    return isPiSessionHeader(header) && path.basename(file).endsWith(`_${header.id}.jsonl`)
      ? header
      : undefined;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function persistedSession(
  directory: string,
  header: PiSessionHeader | undefined,
  readSession: (file: string) => PiSessionHeader | undefined,
): string | undefined {
  if (!header) return undefined;
  try {
    const files = readdirSync(directory).filter((file) => file.endsWith(`_${header.id}.jsonl`));
    if (files.length !== 1) return undefined;
    const file = path.join(directory, files[0] as string);
    const stored = readSession(file);
    return stored?.id === header.id && stored.cwd === header.cwd ? file : undefined;
  } catch {
    return undefined;
  }
}
