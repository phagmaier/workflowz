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

  it("preserves failed version and help statuses even if all markers are present", async () => {
    const markers = HELP_PROBES.claude?.markers.join(" ") ?? "";
    const result = await probeHarness(CLAUDE, async (_binary, args) => ({
      exitCode: args[0] === "--version" ? 7 : 9,
      stdout: args[0] === "--version" ? "fatal: broken installation" : markers,
      stderr: "",
    }));
    assert.equal(result.version, undefined);
    assert.deepEqual(result.missingMarkers, []);
    assert.match(result.problem ?? "", /version command exited with status 7/);
    assert.match(result.problem ?? "", /help command exited with status 9/);
  });

  it("preserves a version timeout even when the help command succeeds", async () => {
    const { run } = fakeRunner(HELP_PROBES.claude?.markers.join(" ") ?? "");
    const result = await probeHarness(CLAUDE, (binary, args) =>
      args[0] === "--version"
        ? Promise.resolve({ exitCode: null, stdout: "", stderr: "", spawnError: "timed out" })
        : run(binary, args),
    );
    assert.equal(result.version, undefined);
    assert.match(result.problem ?? "", /version command failed: timed out/);
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

  it("retains separate stdout and stderr from an unsuccessful offline command", async () => {
    const result = await runProbeCommand(process.execPath, [
      "-e",
      'process.stdout.write("version text"); process.stderr.write("broken setup"); process.exitCode = 7',
    ]);
    assert.equal(result.exitCode, 7);
    assert.equal(result.stdout, "version text");
    assert.equal(result.stderr, "broken setup");
    assert.equal(result.spawnError, undefined);
  });

  it("cleans up descendants left by an offline command before resolving", async () => {
    const result = await runProbeCommand(process.execPath, [
      "-e",
      `const { spawn } = require('node:child_process');
       const child = spawn('sleep', ['30'], { stdio: 'ignore' });
       console.log(child.pid);
       child.unref();`,
    ]);
    const childPid = Number(result.stdout.trim());
    assert.ok(Number.isSafeInteger(childPid) && childPid > 0, "probe must capture the child pid");
    assert.throws(
      () => process.kill(childPid, 0),
      (error: NodeJS.ErrnoException) => error.code === "ESRCH",
    );
  });

  it("reports oversized probe output instead of accepting truncated compatibility evidence", async () => {
    const result = await runProbeCommand(process.execPath, [
      "-e",
      'process.stdout.write("x".repeat(5 * 1024 * 1024))',
    ]);
    assert.equal(result.stdout.length, 4 * 1024 * 1024);
    assert.match(result.spawnError ?? "", /exceeded the capture limit/);
  });
});
