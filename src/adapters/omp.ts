/** Installed oh-my-pi dialect of the shared Pi-family one-shot process adapter. */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PiAdapter, type PiAdapterOptions } from "./pi.js";
import { type CommandRunner, runProbeCommand } from "./probe.js";

/** Version/help only: no user configuration, authentication or provider execution. */
export async function createOmpAdapter(
  options: PiAdapterOptions = {},
  run?: CommandRunner,
): Promise<PiAdapter> {
  const probeDir = mkdtempSync(path.join(os.tmpdir(), "wf-omp-probe-"));
  try {
    const command =
      run ??
      ((binary, args) =>
        runProbeCommand(binary, args, {
          PATH: options.environment?.PATH ?? process.env.PATH,
          HOME: probeDir,
          PI_CODING_AGENT_DIR: path.join(probeDir, "agent"),
          XDG_CONFIG_HOME: path.join(probeDir, "config"),
          XDG_DATA_HOME: path.join(probeDir, "data"),
          XDG_STATE_HOME: path.join(probeDir, "state"),
          XDG_CACHE_HOME: path.join(probeDir, "cache"),
          OTEL_SDK_DISABLED: "true",
        }));
    const checked = async (args: string[]) => {
      const result = await command(options.binary ?? "omp", [
        ...(options.prefixArgs ?? []),
        ...args,
      ]);
      if (result.spawnError || result.exitCode !== 0)
        throw new Error(
          `omp compatibility probe failed (${args.join(" ")}): ${result.spawnError ?? `exit ${result.exitCode}`}`,
        );
      return result.stdout;
    };
    const version = (await checked(["--version"])).trim();
    if (!/^omp\/\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version))
      throw new Error("omp compatibility probe returned an unrecognized version");
    const help = await checked(["--help"]);
    const advertised = (flag: string) => new RegExp(`(?:^|\\s)${flag}(?:\\s|[=<,])`).test(help);
    const missing = [
      "--print",
      "--mode",
      "--model",
      "--thinking",
      "--session-dir",
      "--approval-mode",
    ].filter((flag) => !advertised(flag));
    if (missing.length || !/\bjson\b/.test(help) || !/\byolo\b/.test(help))
      throw new Error(
        `omp JSON mode is incompatible; help does not advertise ${missing.join(", ") || "json/yolo"}`,
      );
    return new PiAdapter(options, { version, supportsResume: advertised("--resume") }, "omp");
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}
