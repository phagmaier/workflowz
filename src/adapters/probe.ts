/**
 * Offline compatibility probe for installed harness CLIs (todo 0.5, architecture §4).
 *
 * It runs `<binary> --version` and `<binary> <help args>` and checks that the help text still
 * advertises the flags the registry's capability claims depend on. It never runs a model, never
 * reads credential files, and never passes the caller's full environment to the child.
 */
import { execFile } from "node:child_process";
import {
  BUILT_IN_HARNESSES,
  type HarnessDescriptor,
  type HarnessRegistry,
} from "./harness-registry.js";

export interface CommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Set when the binary could not be started, for example `ENOENT` when it is not on PATH. */
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

export const runProbeCommand: CommandRunner = (binary, args) =>
  new Promise((resolve) => {
    execFile(
      binary,
      [...args],
      {
        env: probeEnvironment(),
        timeout: PROBE_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (
          error &&
          typeof (error as NodeJS.ErrnoException).code === "string" &&
          !("killed" in error && error.killed)
        ) {
          const code = (error as NodeJS.ErrnoException).code as string;
          if (code === "ENOENT" || code === "EACCES") {
            resolve({ exitCode: null, stdout: "", stderr: "", spawnError: code });
            return;
          }
        }
        resolve({
          exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
          spawnError: error && "killed" in error && error.killed ? "timed out" : undefined,
        });
      },
    );
  });

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
      problem: `'${descriptor.binary}' was not found on PATH (${version.spawnError})`,
    };
  }

  const probe = HELP_PROBES[descriptor.id];
  const help = probe ? await run(descriptor.binary, probe.args) : undefined;
  const helpText = `${help?.stdout ?? ""}\n${help?.stderr ?? ""}`;
  const missingMarkers = (probe?.markers ?? []).filter((marker) => !helpText.includes(marker));

  const problems: string[] = [];
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
    version: firstLine(version.stdout) || firstLine(version.stderr) || undefined,
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
