/** Installed oh-my-pi dialect of the shared Pi-family one-shot process adapter. */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PiAdapter, type PiAdapterOptions } from "./pi.js";
import {
  CapabilityProbeError,
  type CommandRunner,
  helpAdvertises,
  probeText,
  runProbeCommand,
} from "./probe.js";

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
      return probeText(result, "omp", args);
    };
    const version = (await checked(["--version"])).trim();
    if (!/^omp\/\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version))
      throw new CapabilityProbeError("omp compatibility probe returned an unrecognized version");
    const help = await checked(["--help"]);
    const advertised = (flag: string) => helpAdvertises(help, flag);
    const missing = ["--print", "--mode", "--session-dir", "--approval-mode"].filter(
      (flag) => !advertised(flag),
    );
    if (!/\bjson\b/.test(help)) missing.push("json");
    if (!/\byolo\b/.test(help)) missing.push("yolo");
    if (missing.length)
      throw new CapabilityProbeError(
        `omp JSON mode is incompatible; help does not advertise ${missing.join(", ")}`,
        missing,
      );
    return new PiAdapter(
      options,
      {
        version,
        supportsResume: advertised("--resume"),
        supportsModelSelection: advertised("--model"),
        supportsReasoningEffort: advertised("--thinking"),
      },
      "omp",
    );
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}
