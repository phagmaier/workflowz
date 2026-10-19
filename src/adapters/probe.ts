/**
 * Offline compatibility probe for installed harness CLIs (todo 0.5, architecture §4).
 *
 * The execution factories run version/help checks and expose their effective capabilities. This
 * inventory reuses those factories and their isolated environments. It never runs a model, never
 * reads credential files, and never passes the caller's full environment to the child.
 */
import {
  BUILT_IN_HARNESSES,
  type HarnessCapabilities,
  type HarnessDescriptor,
  type HarnessRegistry,
} from "./harness-registry.js";
import { startProcess } from "./process.js";
import { environmentSecrets } from "./secrets.js";

export interface CommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Set when launch or supervised completion failed, including timeout and truncated output. */
  readonly spawnError?: string | undefined;
}

export type CommandRunner = (binary: string, args: readonly string[]) => Promise<CommandResult>;

/** Probe failures contain safe runner-owned explanations, not CLI stdout/stderr. */
export class CapabilityProbeError extends Error {
  constructor(
    message: string,
    readonly missingMarkers: readonly string[] = [],
    readonly installed = true,
  ) {
    super(message);
  }
}

export function helpAdvertises(help: string, flag: string): boolean {
  return new RegExp(`(?:^|\\s)${flag}(?:\\s|[=<,]|$)`).test(help);
}

export function probeText(result: CommandResult, harness: string, args: readonly string[]): string {
  const failure =
    result.spawnError === "ENOENT"
      ? "executable was not found on PATH (ENOENT)"
      : result.spawnError === "EACCES"
        ? "executable could not be executed (EACCES)"
        : (result.spawnError ?? `exit ${result.exitCode}`);
  if (result.spawnError || result.exitCode !== 0)
    throw new CapabilityProbeError(
      `${harness} compatibility probe failed (${args.join(" ")}): ${failure}`,
      [],
      result.spawnError !== "ENOENT" && result.spawnError !== "EACCES",
    );
  return result.stdout;
}

export interface HarnessProbeResult {
  readonly id: string;
  readonly product: string;
  readonly binary: string;
  readonly installed: boolean;
  readonly version?: string | undefined;
  readonly capabilities?: HarnessCapabilities | undefined;
  /** Required markers the factory help text did not contain. Empty when every claim is advertised. */
  readonly missingMarkers: readonly string[];
  /** Human-readable explanation of anything that prevents a clean result. */
  readonly problem?: string | undefined;
}

const PROBE_TIMEOUT_MS = 15_000;
const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
] as const;

/** The only environment a probe child receives. */
export function probeEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ENV_ALLOWLIST) {
    const value = source[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return env;
}

export async function runProbeCommand(
  binary: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = probeEnvironment(),
): Promise<CommandResult> {
  try {
    const result = await startProcess({
      command: binary,
      args,
      cwd: process.cwd(),
      env: environment,
      secrets: environmentSecrets(environment),
      timeoutMs: PROBE_TIMEOUT_MS,
      stdoutLimit: 4 * 1024 * 1024,
      stderrLimit: 4 * 1024 * 1024,
    }).completed;
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      spawnError:
        result.spawnError ??
        (result.timedOut
          ? "timed out"
          : result.signal !== null
            ? `ended by signal ${result.signal}`
            : result.stdoutTruncated || result.stderrTruncated
              ? "probe output exceeded the capture limit"
              : undefined),
    };
  } catch {
    return {
      exitCode: null,
      stdout: "",
      stderr: "",
      spawnError: "probe supervision failed; process settlement is uncertain",
    };
  }
}

/** Inventory uses the same isolated factories as execution; no parallel marker convention. */
export async function probeHarness(
  descriptor: HarnessDescriptor,
  run?: CommandRunner,
): Promise<HarnessProbeResult> {
  const base = { id: descriptor.id, product: descriptor.product, binary: descriptor.binary };
  try {
    const options = { binary: descriptor.binary };
    const adapter = await (async () => {
      switch (descriptor.id) {
        case "codex":
          return (await import("./codex.js")).createCodexAdapter(options, run);
        case "pi":
          return (await import("./pi.js")).createPiAdapter(options, run);
        case "claude":
          return (await import("./claude.js")).createClaudeAdapter(options, run);
        case "opencode":
          return (await import("./opencode.js")).createOpenCodeAdapter(options, run);
        case "omp":
          return (await import("./omp.js")).createOmpAdapter(options, run);
        default:
          throw new CapabilityProbeError("no offline adapter probe is defined for this harness");
      }
    })();
    return {
      ...base,
      installed: true,
      version: adapter.compatibility.version,
      capabilities: adapter.capabilities,
      missingMarkers: [],
    };
  } catch (error) {
    return {
      ...base,
      installed: error instanceof CapabilityProbeError ? error.installed : true,
      missingMarkers: error instanceof CapabilityProbeError ? error.missingMarkers : [],
      problem:
        error instanceof CapabilityProbeError
          ? error.message
          : "adapter compatibility probe failed",
    };
  }
}

export async function probeHarnesses(
  registry: HarnessRegistry = BUILT_IN_HARNESSES,
  run?: CommandRunner,
): Promise<HarnessProbeResult[]> {
  const results: HarnessProbeResult[] = [];
  for (const descriptor of registry.values()) results.push(await probeHarness(descriptor, run));
  return results;
}
