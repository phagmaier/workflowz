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
import { ClaudeAdapter, createClaudeAdapter } from "./claude.js";

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
async function fixture(
  plan: readonly (Omit<AgentScript, "mode"> & { mode: string })[],
  options: ScriptedOptions = {},
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-claude-"));
  roots.push(root);
  const config = path.join(root, "fixture.json");
  const capture = path.join(root, "capture.json");
  writeFileSync(config, JSON.stringify({ plan, options, capture }));
  const settings = {
    binary: process.execPath,
    prefixArgs: [path.join(REPO_ROOT, "test/fixtures/fake-claude.mjs"), config],
    environment: { PATH: process.env.PATH, HOME: root, CLAUDE_CONFIG_DIR: root },
  };
  return { root, config, capture, settings, adapter: await createClaudeAdapter(settings) };
}

describeAdapterConformance(
  "Claude CLI via offline fixture",
  async (plan, options = {}) => {
    const f = await fixture(plan, options);
    return options.binary
      ? new ClaudeAdapter({ ...f.settings, binary: options.binary }, f.adapter.compatibility)
      : f.adapter;
  },
  "claude",
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

describe("Claude invocation and compatibility", () => {
  it("rejects failed probes, unknown versions and missing stream/permission/effort flags", async () => {
    for (const result of [
      { exitCode: 1, stdout: "2.1.303 (Claude Code)", stderr: "" },
      { exitCode: 0, stdout: "unknown", stderr: "" },
      { exitCode: 0, stdout: "2.1.303 (Claude Code)", stderr: "", spawnError: "timed out" },
    ])
      await assert.rejects(
        createClaudeAdapter({}, async () => result),
        /probe/,
      );
    await assert.rejects(
      createClaudeAdapter({}, async (_binary, args) => ({
        exitCode: 0,
        stderr: "",
        stdout:
          args[0] === "--version" ? "2.1.303 (Claude Code)" : "--print --output-format stream-json",
      })),
      /incompatible/,
    );
    const f = await fixture([], { supportsResume: false });
    assert.equal(f.adapter.compatibility.supportsResume, false);
    assert.equal(f.adapter.resumeForReportCorrection, undefined);
    assert.throws(
      () =>
        f.adapter.start({
          ...input(f.root),
          priorSessionId: "00000000-0000-4000-8000-000000000001",
        }),
      ResumeUnavailableError,
    );
  });
  it("delivers stdin/model/effort/cwd and selects an explicit scrubbed environment", async () => {
    const f = await fixture([{ mode: "silent" }]);
    const adapter = new ClaudeAdapter(
      {
        ...f.settings,
        environment: {
          PATH: process.env.PATH,
          HOME: f.root,
          CLAUDE_CONFIG_DIR: f.root,
          ANTHROPIC_API_KEY: "synthetic-provider-key",
          CLAUDE_CODE_OAUTH_TOKEN: "synthetic-oauth-token",
          CODEX_API_KEY: "withhold",
          PI_CODING_AGENT_DIR: "withhold",
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
      model: "chosen-model",
      reasoningEffort: "xhigh",
    });
    const result = await running.completed;
    assert.equal(result.providerError, undefined);
    const c = captured(f.capture);
    assert.equal(c.prompt, "private\nこんにちは🙂\u2028\u2029");
    assert.equal(c.args.includes(c.prompt), false);
    assert.equal(c.args[c.args.indexOf("--model") + 1], "chosen-model");
    assert.equal(c.args[c.args.indexOf("--effort") + 1], "xhigh");
    assert.equal(c.args[c.args.indexOf("--permission-mode") + 1], "bypassPermissions");
    assert.equal(c.cwd, f.root);
    for (const name of ["WF_REPORT_TOKEN", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"])
      assert.equal(c.env[name], "[present]");
    assert.ok(c.env.PATH?.startsWith(path.join(REPO_ROOT, "bin")));
    for (const name of [
      "CODEX_API_KEY",
      "PI_CODING_AGENT_DIR",
      "CLAUDECODE",
      "NODE_OPTIONS",
      "RANDOM_SECRET",
    ])
      assert.equal(c.env[name], undefined);
    assert.equal(
      c.args.some((arg) =>
        /test-token-never-log|synthetic-provider-key|synthetic-oauth-token/.test(arg),
      ),
      false,
    );
    assert.equal(running.launchInfo?.permissionMode, "bypassPermissions");
    assert.throws(
      () => adapter.start({ ...input(f.root), reasoningEffort: "unsupported" }),
      /effort must be/,
    );
    assert.throws(
      () => adapter.start({ ...input(f.root), reportAccess: undefined }),
      /report channel/,
    );
  });
  it("uses only the exact persisted UUID for resume and rejects selectors before launch", async () => {
    const f = await fixture([{ mode: "silent" }, { mode: "silent" }]);
    const first = await f.adapter.start(input(f.root)).completed;
    assert.ok(first.sessionId);
    const result = await f.adapter.start({ ...input(f.root), priorSessionId: first.sessionId })
      .completed;
    assert.equal(result.resumeUnavailable, undefined);
    assert.equal(result.providerError, undefined);
    assert.equal(result.sessionId, first.sessionId);
    const c = captured(f.capture);
    assert.equal(c.args[c.args.indexOf("--resume") + 1], first.sessionId);
    for (const id of ["", "latest", "--continue", "partial-uuid", "/transcript.jsonl"])
      assert.throws(
        () => f.adapter.start({ ...input(f.root), priorSessionId: id }),
        ResumeUnavailableError,
      );
    rmSync(path.join(f.root, `${first.sessionId}.json`));
    const missing = await f.adapter.start({ ...input(f.root), priorSessionId: first.sessionId })
      .completed;
    assert.equal(missing.resumeUnavailable, true);
    assert.equal(missing.sessionId, first.sessionId);
    assert.equal(missing.exitCode, 1);
  });
  it("scrubs injected provider credentials split across stdout/stderr chunks and disk logs", async () => {
    const f = await fixture([{ mode: "leak-credentials" }]);
    const keys = {
      ANTHROPIC_API_KEY: "synthetic-provider-key",
      CLAUDE_CODE_OAUTH_TOKEN: "synthetic-oauth-token",
    };
    const adapter = new ClaudeAdapter(
      { ...f.settings, environment: { ...f.settings.environment, ...keys } },
      f.adapter.compatibility,
    );
    const logPath = path.join(f.root, "output.log");
    const result = await adapter.start({ ...input(f.root), logPath }).completed;
    assert.equal(result.providerError, undefined);
    const log = readFileSync(logPath, "utf8");
    for (const key of Object.values(keys)) {
      assert.equal(log.includes(key), false);
      assert.equal(result.stdout.includes(key), false);
    }
    assert.match(log, /\[redacted\]/);
  });
  it("rejects unexpected identity without replacing the persisted target", async () => {
    const f = await fixture([{ mode: "silent" }, { mode: "different-session" }]);
    const first = await f.adapter.start(input(f.root)).completed;
    assert.ok(first.sessionId);
    const result = await f.adapter.start({ ...input(f.root), priorSessionId: first.sessionId })
      .completed;
    assert.equal(result.resumeUnavailable, true);
    assert.equal(result.sessionId, first.sessionId);
  });
  it("continues parsing beyond bounded stdout capture", async () => {
    const f = await fixture([{ mode: "large-stream" }]);
    const result = await f.adapter.start(input(f.root)).completed;
    assert.equal(result.providerError, undefined);
    assert.equal(Buffer.byteLength(result.stdout), 65536);
    assert.ok(result.sessionId);
  });
  it("requires process settlement after result", async () => {
    const f = await fixture([{ mode: "terminal-then-hang" }]);
    const result = await f.adapter.start({ ...input(f.root), timeoutMs: 250 }).completed;
    assert.equal(result.timedOut, true);
    assert.equal(result.providerError, undefined);
  });
  it("retains timeout precedence when an unavailable-session result does not exit", async () => {
    const f = await fixture([{ mode: "silent" }, { mode: "unavailable-then-hang" }]);
    const first = await f.adapter.start(input(f.root)).completed;
    assert.ok(first.sessionId);
    const result = await f.adapter.start({
      ...input(f.root),
      priorSessionId: first.sessionId,
      timeoutMs: 250,
    }).completed;
    assert.equal(result.timedOut, true);
    assert.equal(result.resumeUnavailable, undefined);
    assert.equal(result.sessionId, first.sessionId);
  });
});

describe("Claude settlement through the real service", () => {
  async function serviceFixture(mode: string) {
    const f = await fixture([{ mode }]);
    const database = new WorkflowDatabase(path.join(f.root, "state.sqlite"));
    const service = new RunService(database, {
      agents: new Map([["claude", f.adapter]]),
      logDir: path.join(f.root, "logs"),
      correctionTimeoutMs: 1000,
    });
    const runId = service.createRun({
      workflowDir: f.root,
      workflowText: `version: 1
name: Claude settlement
project: { root: . }
start: work
steps:
  work:
    kind: agent
    harness: claude
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
  it("allows native API retry before final success and audits launch metadata", async () => {
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
      const events = f.inspect().events.filter((e) => e.type === "invocation_started");
      assert.equal(events.length, 1);
      assert.equal(events[0]?.data.permissionMode, "bypassPermissions");
      assert.equal(events[0]?.data.harnessVersion, "2.1.303 (Claude Code)");
    } finally {
      f.database.close();
    }
  });
  for (const mode of [
    "assistant-only",
    "invalid-json",
    "truncated",
    "provider-error",
    "report-then-error",
  ])
    it(`does not request correction after ${mode}`, async () => {
      const f = await serviceFixture(mode);
      try {
        await f.service.drive(f.runId);
        assert.equal(f.inspect().run.status, "paused");
        assert.equal(f.inspect().transitions[0]?.outcome, "system.process_error");
        assert.equal(f.inspect().events.filter((e) => e.type === "correction_requested").length, 0);
        assert.equal(
          f.service.coordinator.reportFor(f.inspect().attempts[0]?.attemptId ?? "") !== undefined,
          mode === "report-then-error",
        );
      } finally {
        f.database.close();
      }
    });
});
