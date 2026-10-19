import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { RunService } from "../runner/run-service.js";
import { WorkflowDatabase } from "../store/database.js";
import { describeAdapterConformance, until } from "../test-support/adapter-conformance.js";
import { REPO_ROOT } from "../test-support/paths.js";
import type { AgentScript, ScriptedOptions } from "../test-support/scripted-agent.js";
import { type AgentInput, ResumeUnavailableError } from "./agent-adapter.js";
import { createOmpAdapter } from "./omp.js";
import { PiAdapter } from "./pi.js";

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
async function fixture(
  plan: readonly (Omit<AgentScript, "mode"> & { mode: string })[],
  options: ScriptedOptions = {},
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-omp-"));
  roots.push(root);
  const config = path.join(root, "fixture.json");
  const capture = path.join(root, "capture.json");
  writeFileSync(config, JSON.stringify({ plan, options, capture }));
  const settings = {
    binary: process.execPath,
    prefixArgs: [path.join(REPO_ROOT, "test/fixtures/fake-omp.mjs"), config],
    environment: { PATH: process.env.PATH, HOME: root, PI_CODING_AGENT_DIR: root },
    sessionDir: path.join(root, "sessions"),
  };
  return { root, config, capture, settings, adapter: await createOmpAdapter(settings) };
}

describeAdapterConformance(
  "omp CLI via offline fixture",
  async (plan, options = {}) => {
    const f = await fixture(plan, options);
    return options.binary
      ? new PiAdapter({ ...f.settings, binary: options.binary }, f.adapter.compatibility, "omp")
      : f.adapter;
  },
  "omp",
);

const input = (cwd: string): AgentInput => ({
  attemptId: "fixture",
  cwd,
  prompt: "test prompt; Do not modify source files",
  instructionFiles: [],
  allowedOutcomes: ["complete"],
  reportAccess: { endpoint: "http://127.0.0.1:1/internal/reports", token: "test-token-never-log" },
});
type Capture = { args: string[]; prompt: string; cwd: string; env: Record<string, string> };
const captured = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Capture;

describe("omp invocation and persistence", () => {
  it("fails incompatible probes and never infers resume from Pi's session flags", async () => {
    for (const result of [
      { exitCode: 1, stdout: "omp/18.12.2", stderr: "" },
      { exitCode: 0, stdout: "18.12.2", stderr: "" },
      { exitCode: 0, stdout: "omp/18.12.2", stderr: "", spawnError: "timed out" },
    ])
      await assert.rejects(
        createOmpAdapter({}, async () => result),
        /probe/,
      );
    for (const help of [
      "--mode json",
      "--print --mode=json --model=x --thinking=x --session-dir=x --approval-mode=write",
    ])
      await assert.rejects(
        createOmpAdapter({}, async (_binary, args) => ({
          exitCode: 0,
          stderr: "",
          stdout: args[0] === "--version" ? "omp/18.12.2" : help,
        })),
        /incompatible/,
      );
    const f = await fixture([], { supportsResume: false });
    assert.equal(f.adapter.compatibility.supportsResume, false);
    assert.equal(f.adapter.resumeForReportCorrection, undefined);
    assert.throws(
      () => f.adapter.start({ ...input(f.root), priorSessionId: "/missing.jsonl" }),
      ResumeUnavailableError,
    );
  });
  it("delivers stdin/model/auto thinking and yolo with selected environment, not parent secrets", async () => {
    const f = await fixture([{ mode: "silent" }]);
    const adapter = new PiAdapter(
      {
        ...f.settings,
        environment: {
          PATH: process.env.PATH,
          HOME: f.root,
          PI_CODING_AGENT_DIR: f.root,
          OMP_PROFILE: "workflow",
          OMP_AUTH_BROKER_URL: "http://127.0.0.1:1",
          OMP_AUTH_BROKER_TOKEN: "synthetic-broker-token",
          OPENAI_API_KEY: "synthetic-provider-key",
          CODEX_API_KEY: "withhold",
          CLAUDECODE: "withhold",
          NODE_OPTIONS: "withhold",
          PI_OFFLINE: "withhold",
          PI_CODING_AGENT_SESSION_DIR: "withhold",
          RANDOM_SECRET: "withhold",
        },
      },
      f.adapter.compatibility,
      "omp",
    );
    const running = adapter.start({
      ...input(f.root),
      prompt: "private\nこんにちは🙂\u2028\u2029",
      model: "openai/chosen",
      reasoningEffort: "auto",
    });
    const result = await running.completed;
    assert.equal(result.exitCode, 0);
    assert.equal(result.providerError, undefined);
    assert.equal(adapter.id, "omp");
    const c = captured(f.capture);
    assert.equal(c.prompt, "private\nこんにちは🙂\u2028\u2029");
    assert.equal(c.args.includes(c.prompt), false);
    assert.equal(c.args[c.args.indexOf("--model") + 1], "openai/chosen");
    assert.equal(c.args[c.args.indexOf("--thinking") + 1], "auto");
    assert.equal(c.args[c.args.indexOf("--approval-mode") + 1], "yolo");
    assert.equal(c.cwd, f.root);
    for (const name of ["WF_REPORT_TOKEN", "OPENAI_API_KEY", "OMP_AUTH_BROKER_TOKEN"])
      assert.equal(c.env[name], "[present]");
    assert.equal(c.env.OMP_PROFILE, "workflow");
    assert.ok(c.env.PATH?.startsWith(path.join(REPO_ROOT, "bin")));
    for (const name of [
      "CODEX_API_KEY",
      "CLAUDECODE",
      "NODE_OPTIONS",
      "PI_OFFLINE",
      "PI_CODING_AGENT_SESSION_DIR",
      "RANDOM_SECRET",
    ])
      assert.equal(c.env[name], undefined);
    for (const flag of [
      "--no-session",
      "--session",
      "--session-id",
      "--continue",
      "--restore",
      "--fork",
      "--auto-approve",
    ])
      assert.equal(c.args.includes(flag), false);
    assert.equal(running.launchInfo?.permissionMode, "yolo");
    assert.throws(
      () => adapter.start({ ...input(f.root), reasoningEffort: "unsupported" }),
      /thinking level/,
    );
  });
  it("scrubs selected provider and broker credentials from streams and disk logs", async () => {
    const f = await fixture([{ mode: "leak-provider" }]);
    const key = "synthetic-provider-credential";
    const token = "synthetic-broker-credential";
    const adapter = new PiAdapter(
      {
        ...f.settings,
        environment: {
          ...f.settings.environment,
          OPENAI_API_KEY: key,
          OMP_AUTH_BROKER_TOKEN: token,
        },
      },
      f.adapter.compatibility,
      "omp",
    );
    const logPath = path.join(f.root, "output.log");
    const result = await adapter.start({ ...input(f.root), logPath }).completed;
    assert.equal(result.exitCode, 0);
    assert.equal(result.providerError, undefined);
    for (const text of [result.stdout, readFileSync(logPath, "utf8")])
      for (const secret of [key, token]) assert.equal(text.includes(secret), false);
  });
  it("reopens only the full persisted path, including omp's leading title slot", async () => {
    const f = await fixture([{ mode: "silent" }, { mode: "silent" }]);
    const first = await f.adapter.start(input(f.root)).completed;
    assert.ok(first.sessionId);
    const resumed = await f.adapter.start({ ...input(f.root), priorSessionId: first.sessionId })
      .completed;
    assert.equal(resumed.exitCode, 0);
    assert.equal(resumed.providerError, undefined);
    assert.equal(resumed.resumeUnavailable, undefined);
    assert.equal(resumed.sessionId, first.sessionId);
    const c = captured(f.capture);
    assert.equal(c.args[c.args.indexOf("--resume") + 1], first.sessionId);
    assert.equal(c.args[c.args.indexOf("--session-dir") + 1], path.dirname(first.sessionId));
    assert.throws(
      () => f.adapter.start({ ...input(os.tmpdir()), priorSessionId: first.sessionId }),
      ResumeUnavailableError,
    );
    for (const invalid of [
      "--continue",
      "0199a213-81c0-7800-8aa1-bbab2a035a53",
      "partial-uuid",
      "relative.jsonl",
      "/missing.jsonl",
    ])
      assert.throws(
        () => f.adapter.start({ ...input(f.root), priorSessionId: invalid }),
        ResumeUnavailableError,
      );
    const text = readFileSync(first.sessionId, "utf8");
    const header = JSON.parse(text.split("\n")[1] ?? "") as { id: string };
    writeFileSync(
      first.sessionId,
      text.replaceAll(header.id, "0199a213-81c0-7800-8aa1-bbab2a035a53"),
    );
    assert.throws(
      () => f.adapter.start({ ...input(f.root), priorSessionId: first.sessionId }),
      ResumeUnavailableError,
    );
    rmSync(first.sessionId);
    assert.throws(
      () => f.adapter.start({ ...input(f.root), priorSessionId: first.sessionId }),
      ResumeUnavailableError,
    );
  });
  it("rejects deleted-at-admission sessions without creating a replacement", async () => {
    const f = await fixture([{ mode: "silent" }, { mode: "deleted-at-admission" }]);
    const first = await f.adapter.start(input(f.root)).completed;
    assert.ok(first.sessionId);
    const result = await f.adapter.start({ ...input(f.root), priorSessionId: first.sessionId })
      .completed;
    assert.equal(result.exitCode, 1);
    assert.equal(result.sessionId, first.sessionId);
    assert.equal(existsSync(first.sessionId), false);
  });
  it("refuses moved-away transcripts rather than allowing the CLI's implicit fork", async () => {
    const f = await fixture([{ mode: "silent" }]);
    const first = await f.adapter.start(input(f.root)).completed;
    assert.ok(first.sessionId);
    appendFileSync(
      first.sessionId,
      JSON.stringify({
        type: "custom_message",
        customType: "session-transfer",
        details: { kind: "departed", to: "elsewhere" },
      }) + "\n",
    );
    assert.throws(
      () => f.adapter.start({ ...input(f.root), priorSessionId: first.sessionId }),
      ResumeUnavailableError,
    );
  });
  it("rejects returned mismatches without replacing the requested durable identity", async () => {
    for (const mode of ["different-session", "wrong-cwd"]) {
      const f = await fixture([{ mode: "silent" }, { mode }]);
      const first = await f.adapter.start(input(f.root)).completed;
      assert.ok(first.sessionId);
      const result = await f.adapter.start({ ...input(f.root), priorSessionId: first.sessionId })
        .completed;
      assert.equal(result.resumeUnavailable, true);
      assert.equal(result.sessionId, first.sessionId);
    }
  });
  it("does not retain a streamed identity without a durable journal", async () => {
    const f = await fixture([{ mode: "unpersisted-session" }]);
    assert.equal((await f.adapter.start(input(f.root)).completed).sessionId, undefined);
  });
  it("continues parsing beyond bounded stdout capture", async () => {
    const f = await fixture([{ mode: "large-stream" }]);
    const result = await f.adapter.start(input(f.root)).completed;
    assert.equal(result.providerError, undefined);
    assert.equal(Buffer.byteLength(result.stdout), 65536);
    assert.ok(result.sessionId);
  });
  it("requires process settlement after terminal agent_end", async () => {
    const f = await fixture([{ mode: "terminal-then-hang" }]);
    const result = await f.adapter.start({ ...input(f.root), timeoutMs: 300 }).completed;
    assert.equal(result.timedOut, true);
    assert.equal(result.providerError, undefined);
  });
});

describe("omp settlement through the real service", () => {
  async function serviceFixture(mode: string) {
    const f = await fixture([{ mode }]);
    const database = new WorkflowDatabase(path.join(f.root, "state.sqlite"));
    const service = new RunService(database, {
      agents: new Map([["omp", f.adapter]]),
      logDir: path.join(f.root, "logs"),
      correctionTimeoutMs: 1000,
    });
    const runId = service.createRun({
      workflowDir: f.root,
      workflowText: `version: 1
name: omp settlement
project: { root: . }
start: work
steps:
  work:
    kind: agent
    harness: omp
    session: fresh
    prompt: send a report
    timeout_seconds: 1
    outcomes: [complete]
    on: { complete: { goto: done } }
  done: { kind: end }
`,
    });
    service.coordinator.start(runId);
    return { ...f, database, service, runId, inspect: () => service.coordinator.inspect(runId) };
  }
  for (const mode of ["retry-then-report", "compaction-then-report"])
    it(`waits for native ${mode} without creating a runner retry and audits launch metadata`, async () => {
      const f = await serviceFixture(mode);
      try {
        const driving = f.service.drive(f.runId);
        await until(() => existsSync(f.capture));
        assert.equal(f.inspect().transitions.length, 0);
        assert.ok(f.inspect().activeAttempt);
        await driving;
        assert.equal(f.inspect().run.status, "completed");
        assert.equal(f.inspect().transitions[0]?.outcome, "complete");
        const starts = f.inspect().events.filter((e) => e.type === "invocation_started");
        assert.equal(starts.length, 1);
        assert.equal(starts[0]?.data.permissionMode, "yolo");
        assert.equal(starts[0]?.data.harnessVersion, "omp/18.12.2");
      } finally {
        f.database.close();
      }
    });
  for (const mode of [
    "end-only",
    "nonterminal-end",
    "pi-settled",
    "invalid-json",
    "truncated",
    "provider-error",
    "report-then-abort",
    "retry-then-hang",
    "compaction-error",
    "wrong-cwd",
  ])
    it(`bypasses report correction after ${mode}`, async () => {
      const f = await serviceFixture(mode);
      try {
        await f.service.drive(f.runId);
        assert.equal(f.inspect().run.status, "paused");
        assert.equal(
          f.inspect().transitions[0]?.outcome,
          mode.endsWith("hang") ? "system.timeout" : "system.process_error",
        );
        assert.equal(f.inspect().events.filter((e) => e.type === "correction_requested").length, 0);
        assert.equal(
          f.service.coordinator.reportFor(f.inspect().attempts[0]?.attemptId ?? "") !== undefined,
          mode === "report-then-abort",
        );
      } finally {
        f.database.close();
      }
    });
});
