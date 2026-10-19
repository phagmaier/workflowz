/**
 * Offline compatibility probe for installed harness CLIs (todo 0.5, architecture §4).
 *
 * It runs `<binary> --version` and `<binary> <help args>` and checks that the help text still
 * advertises the flags the registry's capability claims depend on. It never runs a model, never
 * reads credential files, and never passes the caller's full environment to the child.
 */
import {
  BUILT_IN_HARNESSES,
  type HarnessDescriptor,
  type HarnessRegistry,
} from "./harness-registry.js";
import { startProcess } from "./process.js";

export interface CommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Set when launch or supervised completion failed, including timeout and truncated output. */
  readonly spawnError?: string | undefined;
}

export type CommandRunner = (binary: string, args: readonly string[]) => Promise<CommandResult>;

export interface HelpProbe {
  readonly args: readonly string[];
  /** Literal substrings the help text must contain for the registry's claims to hold. */
  readonly markers: readonly string[];
}

/** Flags each harness's capability claims rely on. Verified against the CLIs listed in the compatibility note. */
export const HELP_PROBES: Readonly<Record<string, HelpProbe>> = {
  codex: {
    args: ["exec", "--help"],
    markers: ["--json", "--output-schema", "resume", "--sandbox", "--model"],
  },
  pi: { args: ["--help"], markers: ["--mode", "--print", "--session", "--resume", "--model"] },
  omp: {
    args: ["--help"],
    markers: ["--mode=", "--print", "--resume", "--model=", "--approval-mode"],
  },
  opencode: { args: ["run", "--help"], markers: ["--format", "--session", "--model", "--auto"] },
  claude: {
    args: ["--help"],
    markers: [
      "--print",
      "--output-format",
      "--resume",
      "--permission-mode",
      "--model",
      "--session-id",
    ],
  },
};

export interface HarnessProbeResult {
  readonly id: string;
  readonly product: string;
  readonly binary: string;
  readonly installed: boolean;
  readonly version?: string | undefined;
  /** Markers the help text did not contain. Empty when every claim is advertised. */
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

export const runProbeCommand: CommandRunner = async (binary, args) => {
  try {
    const result = await startProcess({
      command: binary,
      args,
      cwd: process.cwd(),
      env: probeEnvironment(),
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
  } catch (error) {
    return {
      exitCode: null,
      stdout: "",
      stderr: "",
      spawnError: error instanceof Error ? error.message : String(error),
    };
  }
};

export async function probeHarness(
  descriptor: HarnessDescriptor,
  run: CommandRunner = runProbeCommand,
): Promise<HarnessProbeResult> {
  const base = { id: descriptor.id, product: descriptor.product, binary: descriptor.binary };
  const version = await run(descriptor.binary, ["--version"]);
  if (version.spawnError === "ENOENT" || version.spawnError === "EACCES") {
    return {
      ...base,
      installed: false,
      missingMarkers: [],
      problem:
        version.spawnError === "ENOENT"
          ? `'${descriptor.binary}' was not found on PATH (ENOENT)`
          : `'${descriptor.binary}' could not be executed (EACCES)`,
    };
  }

  const probe = HELP_PROBES[descriptor.id];
  const help = probe ? await run(descriptor.binary, probe.args) : undefined;
  const helpText = `${help?.stdout ?? ""}\n${help?.stderr ?? ""}`;
  const missingMarkers = (probe?.markers ?? []).filter((marker) => !helpText.includes(marker));

  const problems: string[] = [];
  if (version.spawnError) {
    problems.push(`version command failed: ${version.spawnError}`);
  } else if (version.exitCode !== 0) {
    problems.push(`version command exited with status ${version.exitCode ?? "unknown"}`);
  }
  if (help && !help.spawnError && help.exitCode !== 0) {
    problems.push(`help command exited with status ${help.exitCode ?? "unknown"}`);
  }
  if (!probe) {
    problems.push("no help probe is defined for this harness");
  }
  if (help?.spawnError) {
    problems.push(`help command failed: ${help.spawnError}`);
  }
  if (missingMarkers.length > 0) {
    problems.push(`help text no longer advertises ${missingMarkers.join(", ")}`);
  }
  return {
    ...base,
    installed: true,
    version:
      version.exitCode === 0 && !version.spawnError
        ? firstLine(version.stdout) || firstLine(version.stderr) || undefined
        : undefined,
    missingMarkers,
    problem: problems.length > 0 ? problems.join("; ") : undefined,
  };
}

export async function probeHarnesses(
  registry: HarnessRegistry = BUILT_IN_HARNESSES,
  run: CommandRunner = runProbeCommand,
): Promise<HarnessProbeResult[]> {
  const results: HarnessProbeResult[] = [];
  for (const descriptor of registry.values()) {
    results.push(await probeHarness(descriptor, run));
  }
  return results;
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}
