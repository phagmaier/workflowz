import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { RunService } from "../runner/run-service.js";
import { WorkflowDatabase } from "../store/database.js";
import { describeAdapterConformance } from "../test-support/adapter-conformance.js";
import { REPO_ROOT } from "../test-support/paths.js";
import type { AgentScript, ScriptedOptions } from "../test-support/scripted-agent.js";
import { type AgentInput, ResumeUnavailableError } from "./agent-adapter.js";
import { createOpenCodeAdapter, OpenCodeAdapter } from "./opencode.js";

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
async function fixture(
  plan: readonly (Omit<AgentScript, "mode"> & { mode: string })[],
  options: ScriptedOptions = {},
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-opencode-"));
  roots.push(root);
  const config = path.join(root, "fixture.json");
  const capture = path.join(root, "capture.json");
  writeFileSync(config, JSON.stringify({ plan, options, capture }));
  const settings = {
    binary: process.execPath,
    prefixArgs: [path.join(REPO_ROOT, "test/fixtures/fake-opencode.mjs"), config],
    environment: { ...process.env, OPENCODE_CONFIG_DIR: root },
  };
  return { root, config, capture, settings, adapter: await createOpenCodeAdapter(settings) };
}
describeAdapterConformance(
  "OpenCode private API via offline CLI",
  async (plan, options = {}) => {
    const f = await fixture(plan, options);
    return options.binary
      ? new OpenCodeAdapter({ ...f.settings, binary: options.binary }, f.adapter.compatibility)
      : f.adapter;
  },
  "opencode",
);
const input = (cwd: string): AgentInput => ({
  attemptId: "fixture",
  cwd,
  prompt: "test prompt",
  instructionFiles: [],
  allowedOutcomes: ["complete"],
  reportAccess: { endpoint: "http://127.0.0.1:1/internal/reports", token: "test-token-never-log" },
});
type Capture = {
  args: string[];
  cwd: string;
  env: Record<string, string>;
  requests: {
    method: string;
    path: string;
    body?: { text?: string; model?: unknown; permissions?: unknown };
  }[];
};
const captured = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Capture;

describe("OpenCode private API invocation", () => {
  it("rejects failed/version/incompatible private-server probes and disables unavailable persistence", async () => {
    for (const result of [
      { exitCode: 1, stdout: "opencode v2.0.32", stderr: "" },
      { exitCode: 0, stdout: "opencode v1.0.0", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "", spawnError: "timed out" },
    ])
      await assert.rejects(
        createOpenCodeAdapter({}, async () => result),
        /probe/,
      );
    await assert.rejects(
      createOpenCodeAdapter({}, async (_binary, args) => ({
        exitCode: 0,
        stderr: "",
        stdout: args[0] === "--version" ? "opencode v2.0.32" : "--port",
      })),
      /incompatible/,
    );
    const f = await fixture([], { supportsResume: false });
    assert.equal(f.adapter.resumeForReportCorrection, undefined);
    assert.throws(
      () => f.adapter.start({ ...input(f.root), priorSessionId: "ses_persisted" }),
      ResumeUnavailableError,
    );
  });
  it("delivers the Unicode prompt through stdin/API, model variant and explicit unrestricted session rules", async () => {
    const f = await fixture([{ mode: "silent" }]);
    const adapter = new OpenCodeAdapter(
      {
        ...f.settings,
        environment: {
          PATH: process.env.PATH,
          HOME: f.root,
          OPENCODE_CONFIG_DIR: f.root,
          OPENAI_API_KEY: "synthetic-key",
          ANTHROPIC_AUTH_TOKEN: "synthetic-token",
          OPENCODE_PASSWORD: "withhold-parent-password",
          CODEX_API_KEY: "withhold",
          NODE_OPTIONS: "withhold",
          RANDOM_SECRET: "withhold",
        },
      },
      f.adapter.compatibility,
    );
    const prompt = "private\nこんにちは🙂\u2028\u2029";
    const handle = adapter.start({
      ...input(f.root),
      prompt,
      model: "provider/model",
      reasoningEffort: "high",
    });
    const result = await handle.completed;
    assert.equal(result.providerError, undefined);
    const c = captured(f.capture);
    const create = c.requests.find((r) => r.path === "/api/session");
    assert.deepEqual(create?.body?.model, { providerID: "provider", id: "model", variant: "high" });
    assert.deepEqual(create?.body?.permissions, [{ action: "*", resource: "*", effect: "allow" }]);
    assert.equal(c.requests.find((r) => r.path.endsWith("/prompt"))?.body?.text, prompt);
    assert.equal(c.args.includes(prompt), false);
    assert.equal(c.cwd, f.root);
    assert.equal(handle.launchInfo?.permissionMode, "session-allow-all");
    assert.equal(c.env.OPENAI_API_KEY, "[present]");
    assert.equal(c.env.ANTHROPIC_AUTH_TOKEN, "[present]");
    assert.equal(c.env.WF_REPORT_TOKEN, "[present]");
    for (const name of ["CODEX_API_KEY", "NODE_OPTIONS", "RANDOM_SECRET"])
      assert.equal(c.env[name], undefined);
    assert.ok(c.env.PATH?.startsWith(path.join(REPO_ROOT, "bin")));
    for (const settings of [
      { model: "bare-model" },
      { reasoningEffort: "high" },
      { model: "p/m#low", reasoningEffort: "high" },
    ])
      assert.throws(() => adapter.start({ ...input(f.root), ...settings }), /OpenCode/);
    assert.throws(
      () => adapter.start({ ...input(f.root), reportAccess: undefined }),
      /report channel/,
    );
  });
  it("resumes only the exact persisted identity, with no create/fork/latest fallback", async () => {
    const f = await fixture([{ mode: "silent" }, { mode: "silent" }, { mode: "silent" }]);
    const first = await f.adapter.start(input(f.root)).completed;
    assert.ok(first.sessionId);
    const result = await f.adapter.start({
      ...input(f.root),
      priorSessionId: first.sessionId,
      model: "p/m#low",
    }).completed;
    assert.equal(result.providerError, undefined);
    assert.equal(result.exitCode, 0);
    assert.equal(result.sessionId, first.sessionId);
    const c = captured(f.capture);
    assert.equal(c.requests[0]?.path, `/api/session/${first.sessionId}`);
    assert.equal(
      c.requests.some((r) => r.method === "POST" && r.path === "/api/session"),
      false,
    );
    assert.deepEqual(c.requests.find((r) => r.path.endsWith("/model"))?.body?.model, {
      providerID: "p",
      id: "m",
      variant: "low",
    });
    for (const id of ["", "latest", "--continue", "ses_/escape", "/transcript"])
      assert.throws(
        () => f.adapter.start({ ...input(f.root), priorSessionId: id }),
        ResumeUnavailableError,
      );
    rmSync(path.join(f.root, `${first.sessionId}.json`));
    const missing = await f.adapter.start({ ...input(f.root), priorSessionId: first.sessionId })
      .completed;
    assert.equal(missing.resumeUnavailable, true);
    assert.equal(missing.sessionId, first.sessionId);
    assert.equal(
      captured(f.capture).requests.some((r) => r.method === "POST"),
      false,
    );
  });
  for (const mode of ["delete-before-admission", "delete-at-admission", "different-session"])
    it(`rejects ${mode} without replacing the requested session`, async () => {
      const f = await fixture([{ mode: "silent" }, { mode }]);
      const first = await f.adapter.start(input(f.root)).completed;
      assert.ok(first.sessionId);
      const result = await f.adapter.start({ ...input(f.root), priorSessionId: first.sessionId })
        .completed;
      assert.equal(result.resumeUnavailable, true);
      assert.equal(result.sessionId, first.sessionId);
      assert.equal(
        captured(f.capture).requests.some((r) => r.path === "/api/session"),
        false,
      );
    });
  it("scrubs split provider keys and private lease credentials from logs", async () => {
    const f = await fixture([{ mode: "leak-credentials" }]);
    const keys = {
      OPENAI_API_KEY: "synthetic-provider-key",
      ANTHROPIC_AUTH_TOKEN: "synthetic-auth-token",
    };
    const adapter = new OpenCodeAdapter(
      { ...f.settings, environment: { ...f.settings.environment, ...keys } },
      f.adapter.compatibility,
    );
    const logPath = path.join(f.root, "output.log");
    const result = await adapter.start({ ...input(f.root), logPath }).completed;
    assert.equal(result.providerError, undefined);
    const log = readFileSync(logPath, "utf8");
    for (const key of Object.values(keys)) assert.equal(log.includes(key), false);
    assert.equal(log.split("[redacted]").length - 1, 3);
  });
  it("does not settle a successful terminal API outcome until the leased process exits", async () => {
    const f = await fixture([{ mode: "terminal-then-hang" }]);
    const result = await f.adapter.start({ ...input(f.root), timeoutMs: 1500 }).completed;
    assert.equal(result.timedOut, true);
    assert.equal(result.providerError, undefined);
    assert.match(result.stdout, /"outcome":"succeeded"/);
  });
  it("keeps timeout precedence when a missing-session response does not release its server", async () => {
    const f = await fixture([{ mode: "silent" }, { mode: "unavailable-then-hang" }]);
    const first = await f.adapter.start(input(f.root)).completed;
    const result = await f.adapter.start({
      ...input(f.root),
      priorSessionId: first.sessionId,
      timeoutMs: 1500,
    }).completed;
    assert.equal(result.timedOut, true);
    assert.equal(result.resumeUnavailable, undefined);
    assert.match(result.stdout, /"kind":"resume_unavailable"/);
    assert.equal(result.sessionId, first.sessionId);
  });
});

describe("OpenCode provider/protocol failures through the service", () => {
  for (const mode of [
    "provider-error",
    "report-then-error",
    "invalid-json",
    "invalid-utf8",
    "oversized",
    "truncated",
    "wrong-admission",
    "missing-terminal",
    "stale-terminal",
    "wrong-wait-ack",
    "bad-ready",
  ])
    it(`bypasses correction after ${mode}`, async () => {
      const f = await fixture([{ mode }]);
      const db = new WorkflowDatabase(path.join(f.root, "state.sqlite"));
      const service = new RunService(db, {
        agents: new Map([["opencode", f.adapter]]),
        logDir: path.join(f.root, "logs"),
      });
      try {
        const run = service.createRun({
          workflowDir: f.root,
          workflowText: `version: 1\nname: OpenCode failure\nproject: {root: .}\nstart: work\nsteps:\n  work:\n    kind: agent\n    harness: opencode\n    session: fresh\n    prompt: send a report\n    timeout_seconds: 5\n    outcomes: [complete]\n    on: {complete: {goto: done}}\n  done: {kind: end}\n`,
        });
        service.coordinator.start(run);
        await service.drive(run);
        const state = service.coordinator.inspect(run);
        assert.equal(state.run.status, "paused");
        assert.equal(state.transitions[0]?.outcome, "system.process_error");
        assert.equal(state.events.filter((e) => e.type === "correction_requested").length, 0);
        assert.equal(
          service.coordinator.reportFor(state.attempts[0]?.attemptId ?? "") !== undefined,
          mode === "report-then-error",
        );
        assert.equal(
          state.events.find((e) => e.type === "invocation_started")?.data.permissionMode,
          "session-allow-all",
        );
      } finally {
        db.close();
      }
    });
});
