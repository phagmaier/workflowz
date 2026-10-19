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
import { CodexAdapter, createCodexAdapter } from "./codex.js";

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
async function fixture(
  plan: readonly (Omit<AgentScript, "mode"> & { mode: string })[],
  options: ScriptedOptions = {},
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-codex-"));
  roots.push(root);
  const config = path.join(root, "fixture.json");
  const capture = path.join(root, "capture.json");
  writeFileSync(config, JSON.stringify({ plan, options, capture }));
  const settings = {
    binary: process.execPath,
    prefixArgs: [path.join(REPO_ROOT, "test/fixtures/fake-codex.mjs"), config],
    environment: { PATH: process.env.PATH, HOME: root, CODEX_HOME: root },
  };
  const adapter = await createCodexAdapter(settings);
  return { root, capture, config, settings, adapter };
}

describeAdapterConformance("Codex CLI via offline fixture", async (plan, options = {}) => {
  const f = await fixture(plan, options);
  // A binary can disappear after a successful probe; conformance exercises the launch failure.
  return options.binary
    ? new CodexAdapter({ ...f.settings, binary: options.binary }, f.adapter.compatibility)
    : f.adapter;
});

const input = (cwd: string): AgentInput => ({
  attemptId: "fixture",
  cwd,
  prompt: "test prompt",
  instructionFiles: [],
  allowedOutcomes: ["complete"],
  reportAccess: { endpoint: "http://127.0.0.1:1/internal/reports", token: "test-token-never-log" },
});

describe("Codex invocation and compatibility", () => {
  it("rejects missing flags or failed probes without launching a model", async () => {
    for (const output of [
      { exitCode: 1, stdout: "codex-cli 0.163.0", stderr: "" },
      { exitCode: 0, stdout: "not a codex version", stderr: "" },
    ])
      await assert.rejects(
        createCodexAdapter({}, async () => output),
        /probe/,
      );
    await assert.rejects(
      createCodexAdapter({}, async (_binary, args) => ({
        exitCode: 0,
        stdout: args[0] === "--version" ? "codex-cli 0.163.0" : "--json",
        stderr: "",
      })),
      /incompatible/,
    );
  });
  it("sends prompt through stdin and selects model/effort/cwd without leaking parent variables", async () => {
    const f = await fixture([{ mode: "silent" }]);
    const adapter = new CodexAdapter(
      {
        ...f.settings,
        environment: {
          PATH: process.env.PATH,
          HOME: f.root,
          CODEX_HOME: f.root,
          CODEX_API_KEY: "synthetic-provider-key",
          ANTHROPIC_API_KEY: "must-not-pass",
          RANDOM_SECRET: "must-not-pass",
          NODE_OPTIONS: "must-not-pass",
        },
      },
      f.adapter.compatibility,
    );
    const started = adapter.start({
      ...input(f.root),
      prompt: "large\nprivate prompt🙂",
      model: "chosen-model",
      reasoningEffort: 'high"quoted',
    });
    const result = await started.completed;
    assert.equal(result.exitCode, 0);
    assert.ok(result.sessionId);
    const captured = JSON.parse(readFileSync(f.capture, "utf8")) as {
      args: string[];
      prompt: string;
      cwd: string;
      env: Record<string, string>;
    };
    assert.equal(captured.prompt, "large\nprivate prompt🙂");
    assert.equal(captured.args.includes(captured.prompt), false);
    assert.equal(captured.args.includes("chosen-model"), true);
    assert.equal(captured.args.includes('model_reasoning_effort="high\\"quoted"'), true);
    assert.equal(captured.cwd, f.root);
    assert.equal(captured.env["WF_REPORT_TOKEN"], "[present]");
    assert.equal(captured.env["CODEX_API_KEY"], "[present]");
    for (const key of ["ANTHROPIC_API_KEY", "RANDOM_SECRET", "NODE_OPTIONS"])
      assert.equal(captured.env[key], undefined);
    assert.equal(captured.env["PATH"]?.startsWith(path.join(REPO_ROOT, "bin")), true);
    assert.equal(
      captured.args.some(
        (arg) => arg.includes("test-token-never-log") || arg.includes("synthetic-provider-key"),
      ),
      false,
    );
    assert.equal(captured.args.includes("--ephemeral"), false);
    assert.equal(started.launchInfo?.harnessVersion, "codex-cli 0.163.0");
  });
  it("rejects invalid session identity before spawn and never chooses --last", async () => {
    const f = await fixture([]);
    assert.throws(
      () => f.adapter.start({ ...input(f.root), priorSessionId: "--last" }),
      ResumeUnavailableError,
    );
    const noResume = await fixture([], { supportsResume: false });
    assert.equal(noResume.adapter.resumeForReportCorrection, undefined);
    assert.throws(
      () =>
        noResume.adapter.start({
          ...input(noResume.root),
          priorSessionId: "0199a213-81c0-7800-8aa1-bbab2a035a53",
        }),
      ResumeUnavailableError,
    );
  });
  it("continues parsing terminal events beyond the bounded stdout capture", async () => {
    const f = await fixture([{ mode: "large-stream" }]);
    const result = await f.adapter.start(input(f.root)).completed;
    assert.equal(result.providerError, undefined);
    assert.equal(Buffer.byteLength(result.stdout), 65536);
    assert.ok(result.sessionId);
  });
  it("terminal JSON is insufficient while the process remains active", async () => {
    const f = await fixture([{ mode: "terminal-then-hang" }]);
    const running = f.adapter.start({ ...input(f.root), timeoutMs: 150 });
    const result = await running.completed;
    assert.equal(result.timedOut, true);
    assert.equal(result.providerError, undefined);
  });
  it("malformed JSON cannot become a clean missing-report correction", async () => {
    const f = await fixture([{ mode: "invalid-json" }]);
    assert.ok((await f.adapter.start(input(f.root)).completed).providerError);
  });
  it("a resumed invocation cannot silently accept a newly opened session", async () => {
    const f = await fixture([{ mode: "silent" }, { mode: "different-session" }]);
    const first = await f.adapter.start(input(f.root)).completed;
    assert.ok(first.sessionId);
    const resumed = await f.adapter.start({ ...input(f.root), priorSessionId: first.sessionId })
      .completed;
    assert.equal(resumed.resumeUnavailable, true);
    assert.equal(
      resumed.sessionId,
      first.sessionId,
      "an unexpected identity must not replace the persisted resume target",
    );
  });
  it("persists version, permission mode and captured session identity through the real service", async () => {
    const f = await fixture([{ mode: "report" }]);
    const database = new WorkflowDatabase(path.join(f.root, "state.sqlite"));
    try {
      const service = new RunService(database, {
        agents: new Map([["codex", f.adapter]]),
        logDir: path.join(f.root, "logs"),
      });
      const runId = service.createRun({
        workflowDir: f.root,
        workflowText: `version: 1
name: Codex metadata
project: { root: . }
start: work
steps:
  work:
    kind: agent
    harness: codex
    session: fresh
    prompt: send a report
    outcomes: [complete]
    on: { complete: { goto: done } }
  done: { kind: end }
`,
      });
      service.coordinator.start(runId);
      assert.deepEqual(await service.drive(runId), { kind: "completed" });
      const state = service.coordinator.inspect(runId);
      const launch = state.events.find((event) => event.type === "invocation_started");
      assert.equal(launch?.data.harnessVersion, "codex-cli 0.163.0");
      assert.equal(launch?.data.permissionMode, "dangerously-bypass-approvals-and-sandbox");
      assert.match(state.attempts[0]?.sessionId ?? "", /^[0-9a-f-]{36}$/);
      assert.equal(
        service.coordinator.reportFor(state.attempts[0]?.attemptId ?? "")?.outcome,
        "complete",
      );
    } finally {
      database.close();
    }
  });
});
