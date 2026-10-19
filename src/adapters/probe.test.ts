import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BUILT_IN_HARNESSES, type HarnessDescriptor } from "./harness-registry.js";
import {
  type CommandRunner,
  HELP_PROBES,
  probeEnvironment,
  probeHarness,
  runProbeCommand,
} from "./probe.js";

const CLAUDE: HarnessDescriptor = BUILT_IN_HARNESSES.get("claude") as HarnessDescriptor;

/** A runner that answers `--version` and the help probe from fixed text, recording what it was asked. */
function fakeRunner(help: string, version = "9.9.9"): { run: CommandRunner; calls: string[] } {
  const calls: string[] = [];
  const run: CommandRunner = async (binary, args) => {
    calls.push(`${binary} ${args.join(" ")}`);
    if (args[0] === "--version") {
      return { exitCode: 0, stdout: `${binary} ${version}\n`, stderr: "" };
    }
    return { exitCode: 0, stdout: help, stderr: "" };
  };
  return { run, calls };
}

describe("harness probe", () => {
  it("reports a missing binary without treating it as an error in the harness", async () => {
    const run: CommandRunner = async () => ({
      exitCode: null,
      stdout: "",
      stderr: "",
      spawnError: "ENOENT",
    });
    const result = await probeHarness(CLAUDE, run);
    assert.equal(result.installed, false);
    assert.match(result.problem ?? "", /not found on PATH/);
  });

  it("reads the version from the first line of --version output", async () => {
    const { run } = fakeRunner(HELP_PROBES.claude?.markers.join("\n") ?? "");
    const result = await probeHarness(CLAUDE, async (binary, args) => {
      if (args[0] === "--version") {
        return { exitCode: 0, stdout: "2.1.303 (Claude Code)\nmore\n", stderr: "" };
      }
      return run(binary, args);
    });
    assert.equal(result.version, "2.1.303 (Claude Code)");
    assert.deepEqual(result.missingMarkers, []);
    assert.equal(result.problem, undefined);
  });

  it("names each advertised flag the help text no longer contains", async () => {
    const { run } = fakeRunner("usage: claude --print --resume\n");
    const result = await probeHarness(CLAUDE, run);
    assert.ok(result.missingMarkers.includes("--permission-mode"));
    assert.ok(!result.missingMarkers.includes("--resume"));
    assert.match(result.problem ?? "", /no longer advertises/);
  });

  it("runs only --version and the help probe, never a model call", async () => {
    const { run, calls } = fakeRunner(HELP_PROBES.claude?.markers.join(" ") ?? "");
    await probeHarness(CLAUDE, run);
    assert.deepEqual(calls, ["claude --version", "claude --help"]);
  });

  it("gives child processes only the allowlisted environment", () => {
    const env = probeEnvironment({
      PATH: "/usr/bin",
      HOME: "/home/u",
      ANTHROPIC_API_KEY: "sk-secret",
      OPENAI_API_KEY: "sk-other",
      GITHUB_TOKEN: "gh-secret",
    });
    assert.deepEqual(Object.keys(env).sort(), ["HOME", "PATH"]);
  });

  it("runs a binary that does not exist and reports ENOENT rather than throwing", async () => {
    const result = await runProbeCommand("workflowz-no-such-binary-xyz", ["--version"]);
    assert.equal(result.spawnError, "ENOENT");
  });
});
