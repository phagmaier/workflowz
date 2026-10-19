import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { RunService } from "../runner/run-service.js";
import { WorkflowDatabase } from "../store/database.js";
import { describeAdapterConformance, until } from "../test-support/adapter-conformance.js";
import { REPO_ROOT } from "../test-support/paths.js";
import type { AgentScript, ScriptedOptions } from "../test-support/scripted-agent.js";
import { type AgentInput, ResumeUnavailableError } from "./agent-adapter.js";
import { createPiAdapter, PiAdapter } from "./pi.js";

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
async function fixture(
  plan: readonly (Omit<AgentScript, "mode"> & { mode: string })[],
  options: ScriptedOptions = {},
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-pi-"));
  roots.push(root);
  const config = path.join(root, "fixture.json");
  const capture = path.join(root, "capture.json");
  writeFileSync(config, JSON.stringify({ plan, options, capture }));
  const settings = {
    binary: process.execPath,
    prefixArgs: [path.join(REPO_ROOT, "test/fixtures/fake-pi.mjs"), config],
    environment: { ...process.env, PI_CODING_AGENT_DIR: root },
    sessionDir: path.join(root, "sessions"),
  };
  return { root, config, capture, settings, adapter: await createPiAdapter(settings) };
}

describeAdapterConformance(
  "Pi CLI via offline fixture",
  async (plan, options = {}) => {
    const f = await fixture(plan, options);
    return options.binary
      ? new PiAdapter({ ...f.settings, binary: options.binary }, f.adapter.compatibility)
      : f.adapter;
  },
  "pi",
);

const input = (cwd: string): AgentInput => ({
  attemptId: "fixture",
  cwd,
  prompt: "test prompt",
  instructionFiles: [],
  allowedOutcomes: ["complete"],
  reportAccess: { endpoint: "http://127.0.0.1:1/internal/reports", token: "test-token-never-log" },
});
type Capture = { args: string[]; prompt: string; cwd: string; env: Record<string, string> };
const captured = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Capture;

describe("Pi invocation and compatibility", () => {
  it("rejects failed probes, unknown versions and absent JSON/required flags", async () => {
    for (const result of [
      { exitCode: 1, stdout: "1.3.0", stderr: "" },
      { exitCode: 0, stdout: "unknown", stderr: "" },
      { exitCode: 0, stdout: "1.3.0", stderr: "", spawnError: "timed out" },
    ])
      await assert.rejects(
        createPiAdapter({}, async () => result),
        /probe/,
      );
    await assert.rejects(
      createPiAdapter({}, async (_binary, args) => ({
        exitCode: 0,
        stderr: "",
        stdout: args[0] === "--version" ? "1.3.0" : "--mode json",
      })),
      /incompatible/,
    );
    const f = await fixture([], { supportsResume: false });
    assert.equal(
      f.adapter.compatibility.supportsResume,
      false,
      "--session-dir does not imply --session",
    );
    assert.equal(f.adapter.resumeForReportCorrection, undefined);
    assert.throws(
      () => f.adapter.start({ ...input(f.root), priorSessionId: "/missing.jsonl" }),
      ResumeUnavailableError,
    );
  });
  it("delivers stdin/model/thinking/cwd/report access with an explicit provider environment", async () => {
    const f = await fixture([{ mode: "silent" }]);
    const adapter = new PiAdapter(
      {
        ...f.settings,
        environment: {
          PATH: process.env.PATH,
          HOME: f.root,
          PI_CODING_AGENT_DIR: f.root,
          OPENAI_API_KEY: "synthetic-provider-key",
          CODEX_API_KEY: "withhold",
          CLAUDECODE: "withhold",
          NODE_OPTIONS: "withhold",
          RANDOM_SECRET: "withhold",
        },
      },
      f.adapter.compatibility,
    );
    const running = adapter.start({
      ...input(f.root),
      prompt: "private\nこんにちは🙂\u2028\u2029",
      model: "openai/chosen-model",
      reasoningEffort: "high",
    });
    const result = await running.completed;
    assert.equal(result.providerError, undefined);
    const c = captured(f.capture);
    assert.equal(c.prompt, "private\nこんにちは🙂\u2028\u2029");
    assert.equal(c.args.includes(c.prompt), false);
    assert.equal(c.args[c.args.indexOf("--model") + 1], "openai/chosen-model");
    assert.equal(c.args[c.args.indexOf("--thinking") + 1], "high");
    assert.equal(c.cwd, f.root);
    assert.equal(c.env.WF_REPORT_TOKEN, "[present]");
    assert.equal(c.env.OPENAI_API_KEY, "[present]");
    assert.equal(c.env.PI_CODING_AGENT_DIR, f.root);
    assert.ok(c.env.PATH?.startsWith(path.join(REPO_ROOT, "bin")));
    for (const name of ["CODEX_API_KEY", "CLAUDECODE", "NODE_OPTIONS", "RANDOM_SECRET"])
      assert.equal(c.env[name], undefined);
    for (const flag of [
      "--no-session",
      "--session-id",
      "--continue",
      "--resume",
      "--approve",
      "--tools",
      "--approval-mode",
    ])
      assert.equal(c.args.includes(flag), false);
    assert.equal(
      c.args.some(
        (arg) => arg.includes("test-token-never-log") || arg.includes("synthetic-provider-key"),
      ),
      false,
    );
    assert.equal(running.launchInfo?.permissionMode, "default-unrestricted-tools");
    assert.throws(
      () => adapter.start({ ...input(f.root), reasoningEffort: "unsupported" }),
      /thinking level/,
    );
  });
  it("reopens only the persisted session file with matching UUID and cwd", async () => {
    const f = await fixture([{ mode: "silent" }, { mode: "silent" }]);
    const original = await f.adapter.start(input(f.root)).completed;
    assert.ok(original.sessionId);
    assert.equal(path.isAbsolute(original.sessionId), true);
    const resumed = await f.adapter.start({ ...input(f.root), priorSessionId: original.sessionId })
      .completed;
    assert.equal(resumed.providerError, undefined);
    assert.equal(resumed.resumeUnavailable, undefined);
    assert.equal(resumed.sessionId, original.sessionId);
    const c = captured(f.capture);
    assert.throws(
      () => f.adapter.start({ ...input(os.tmpdir()), priorSessionId: original.sessionId }),
      ResumeUnavailableError,
    );
    const text = readFileSync(original.sessionId, "utf8");
    const header = JSON.parse(text.split("\n")[0] ?? "") as { id: string };
    assert.equal(c.args[c.args.indexOf("--session") + 1], header.id);
    assert.equal(c.args[c.args.indexOf("--session-dir") + 1], path.dirname(original.sessionId));
    writeFileSync(
      original.sessionId,
      text.replaceAll(header.id, "0199a213-81c0-7800-8aa1-bbab2a035a53"),
    );
    assert.throws(
      () => f.adapter.start({ ...input(f.root), priorSessionId: original.sessionId }),
      ResumeUnavailableError,
    );
    for (const invalid of ["--continue", "partial-uuid", "relative.jsonl", "/missing.jsonl"])
      assert.throws(
        () => f.adapter.start({ ...input(f.root), priorSessionId: invalid }),
        ResumeUnavailableError,
      );
    rmSync(original.sessionId);
    assert.throws(
      () => f.adapter.start({ ...input(f.root), priorSessionId: original.sessionId }),
      ResumeUnavailableError,
    );
  });
  it("rejects unexpected resume identity without replacing the persisted target", async () => {
    const f = await fixture([{ mode: "silent" }, { mode: "different-session" }]);
    const first = await f.adapter.start(input(f.root)).completed;
    assert.ok(first.sessionId);
    const result = await f.adapter.start({ ...input(f.root), priorSessionId: first.sessionId })
      .completed;
    assert.equal(result.resumeUnavailable, true);
    assert.equal(result.sessionId, first.sessionId);
  });
  it("does not persist a streamed identity without a durable session file", async () => {
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
  it("requires process settlement after agent_settled", async () => {
    const f = await fixture([{ mode: "terminal-then-hang" }]);
    const result = await f.adapter.start({ ...input(f.root), timeoutMs: 250 }).completed;
    assert.equal(result.timedOut, true);
    assert.equal(result.providerError, undefined);
  });
});

describe("Pi settlement through the real service", () => {
  async function serviceFixture(mode: string, extra = "") {
    const f = await fixture([{ mode, extra }]);
    const database = new WorkflowDatabase(path.join(f.root, "state.sqlite"));
    const service = new RunService(database, {
      agents: new Map([["pi", f.adapter]]),
      logDir: path.join(f.root, "logs"),
      correctionTimeoutMs: 1000,
    });
    const runId = service.createRun({
      workflowDir: f.root,
      workflowText: `version: 1
name: Pi settlement
project: { root: . }
start: work
steps:
  work:
    kind: agent
    harness: pi
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
  it("allows Pi's automatic retry to finish before routing and audits launch metadata", async () => {
    const f = await serviceFixture("retry-then-report");
    try {
      const driving = f.service.drive(f.runId);
      await until(() => {
        try {
          return captured(f.capture).prompt.length > 0;
        } catch {
          return false;
        }
      });
      assert.equal(f.inspect().transitions.length, 0);
      assert.ok(f.inspect().activeAttempt);
      await driving;
      assert.equal(f.inspect().run.status, "completed");
      assert.equal(f.inspect().transitions[0]?.outcome, "complete");
      assert.equal(f.inspect().events.filter((e) => e.type === "invocation_started").length, 1);
      assert.equal(
        f.inspect().events.find((e) => e.type === "invocation_started")?.data.permissionMode,
        "default-unrestricted-tools",
      );
      assert.equal(
        f.inspect().events.find((e) => e.type === "invocation_started")?.data.harnessVersion,
        "1.3.0",
      );
    } finally {
      f.database.close();
    }
  });
  for (const mode of [
    "end-only",
    "invalid-json",
    "provider-error",
    "report-then-abort",
    "retry-then-hang",
  ])
    it(`does not request report correction after ${mode}`, async () => {
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
