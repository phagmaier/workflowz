import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BUILT_IN_HARNESSES, type HarnessDescriptor } from "./harness-registry.js";
import {
  type CommandRunner,
  helpAdvertises,
  probeEnvironment,
  probeHarness,
  runProbeCommand,
} from "./probe.js";

const CLAUDE: HarnessDescriptor = BUILT_IN_HARNESSES.get("claude") as HarnessDescriptor;
const HELP =
  "--print --input-format text --output-format stream-json --verbose --permission-mode bypassPermissions --model --effort --resume";
const fakeRunner =
  (help = HELP): CommandRunner =>
  async (_binary, args) => ({
    exitCode: 0,
    stderr: "",
    stdout: args.includes("--version") ? "2.1.303 (Claude Code)" : help,
  });

describe("harness probe", () => {
  it("matches complete flags at EOF and assignment syntax without accepting longer flag names", () => {
    assert.equal(helpAdvertises("--model", "--model"), true);
    assert.equal(helpAdvertises("--model=<name>", "--model"), true);
    assert.equal(helpAdvertises("--model-extra", "--model"), false);
    assert.equal(helpAdvertises("--session-dir", "--session"), false);
  });
  it("reports a missing binary without treating it as provider failure", async () => {
    const result = await probeHarness(CLAUDE, async () => ({
      exitCode: null,
      stdout: "",
      stderr: "",
      spawnError: "ENOENT",
    }));
    assert.equal(result.installed, false);
    assert.match(result.problem ?? "", /ENOENT/);
    assert.equal(result.capabilities, undefined);
  });
  it("uses the actual adapter factory's version, transport and optional capabilities", async () => {
    const result = await probeHarness(
      CLAUDE,
      fakeRunner(HELP.replace("--resume", "--resume-extra")),
    );
    assert.equal(result.version, "2.1.303 (Claude Code)");
    assert.equal(result.capabilities?.supportsResume, false);
    assert.equal(result.capabilities?.supportsModelSelection, true);
    assert.equal(result.capabilities?.supportsStructuredFinalOutput, false);
    assert.deepEqual(result.missingMarkers, []);
    assert.equal(result.problem, undefined);
  });
  it("names required flags using the same matching rules as the factory", async () => {
    const result = await probeHarness(
      CLAUDE,
      fakeRunner(HELP.replace("--verbose", "--verbose-extra")),
    );
    assert.deepEqual(result.missingMarkers, ["--verbose"]);
    assert.match(result.problem ?? "", /incompatible/);
    assert.equal(result.capabilities, undefined);
  });
  it("does not accept failed/truncated probe evidence even with all markers", async () => {
    for (const bad of [
      { exitCode: 7 },
      { exitCode: 0, spawnError: "probe output exceeded the capture limit" },
    ]) {
      const result = await probeHarness(CLAUDE, async (_binary, args) => ({
        ...(await fakeRunner()(_binary, args)),
        ...bad,
      }));
      assert.equal(result.version, undefined);
      assert.equal(result.capabilities, undefined);
      assert.match(result.problem ?? "", /probe failed/);
    }
  });
  it("runs only version/help through the factory and keeps unknown failures out of diagnostics", async () => {
    const calls: string[][] = [];
    await probeHarness(CLAUDE, async (binary, args) => {
      calls.push([...args]);
      return fakeRunner()(binary, args);
    });
    assert.deepEqual(calls, [["--version"], ["--help"]]);
    const result = await probeHarness(CLAUDE, async () => {
      throw new Error("untrusted secret output");
    });
    assert.equal(result.problem?.includes("secret"), false);
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

  it("scrubs explicitly selected synthetic probe credentials on failure", async () => {
    const result = await runProbeCommand(
      process.execPath,
      [
        "-e",
        'process.stdout.write(Buffer.from(process.env.API_TOKEN).toString("base64")); process.stderr.write(process.env.API_TOKEN); process.exitCode = 7',
      ],
      { API_TOKEN: "synthetic-probe-credential" },
    );
    assert.equal(result.exitCode, 7);
    assert.equal(result.stdout, "[redacted]");
    assert.equal(result.stderr, "[redacted]");
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
