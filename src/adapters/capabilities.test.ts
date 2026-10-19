/** Installed capabilities are factory evidence; session availability is an independent admission check. */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { RunService } from "../runner/run-service.js";
import { WorkflowDatabase } from "../store/database.js";
import { REPO_ROOT } from "../test-support/paths.js";
import { AdapterPreflightError, type AgentInput } from "./agent-adapter.js";
import { createClaudeAdapter } from "./claude.js";
import { createCodexAdapter } from "./codex.js";
import { BUILT_IN_HARNESSES, type HarnessDescriptor } from "./harness-registry.js";
import { createOmpAdapter } from "./omp.js";
import { createOpenCodeAdapter } from "./opencode.js";
import { createPiAdapter } from "./pi.js";
import { probeHarness, runProbeCommand } from "./probe.js";

const factories = {
  codex: createCodexAdapter,
  pi: createPiAdapter,
  claude: createClaudeAdapter,
  opencode: createOpenCodeAdapter,
  omp: createOmpAdapter,
};
const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
function fixture(id: keyof typeof factories, probe = {}, supportsResume = true, mode = "report") {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-capabilities-"));
  roots.push(root);
  const config = path.join(root, "fixture.json");
  const capture = path.join(root, "capture.json");
  writeFileSync(
    config,
    JSON.stringify({ plan: [{ mode }], options: { probe, supportsResume }, capture }),
  );
  const settings = {
    binary: process.execPath,
    prefixArgs: [path.join(REPO_ROOT, `test/fixtures/fake-${id}.mjs`), config],
    sessionDir: path.join(root, "sessions"),
    environment: {
      PATH: process.env.PATH,
      HOME: root,
      CODEX_HOME: root,
      CLAUDE_CONFIG_DIR: root,
      OPENCODE_CONFIG_DIR: root,
      PI_CODING_AGENT_DIR: root,
    },
  };
  const launched = () =>
    (JSON.parse(readFileSync(config, "utf8")) as { index?: number }).index ?? 0;
  return { root, config, capture, settings, launched, create: () => factories[id](settings) };
}
const input = (root: string): AgentInput => ({
  attemptId: "offline",
  cwd: root,
  prompt: "go",
  instructionFiles: [],
  allowedOutcomes: ["complete"],
  reportAccess: { endpoint: "http://127.0.0.1:1/internal/reports", token: "synthetic-test-token" },
  timeoutMs: 2000,
});
const workflow = (id: string, extra = "", resume = false) => `version: 1
name: offline capabilities
project: { root: . }
start: first
steps:
  first:
    kind: agent
    harness: ${id}
    session: fresh
    prompt: go
    outcomes: [complete]
${extra}
    on: { complete: { goto: ${resume ? "followup" : "done"} } }
${
  resume
    ? `  followup:
    kind: agent
    harness: ${id}
    session: resume
    prompt: continue
    outcomes: [complete]
    on: { complete: { goto: done } }
`
    : ""
}  done: { kind: end }
`;
async function service(f: ReturnType<typeof fixture>, id: string, text: string) {
  const adapter = await f.create();
  const database = new WorkflowDatabase(path.join(f.root, "state.sqlite"));
  const service = new RunService(database, {
    agents: new Map([[id, adapter]]),
    logDir: path.join(f.root, "logs"),
    correctionTimeoutMs: 500,
  });
  const runId = service.createRun({ workflowText: text, workflowDir: f.root });
  service.coordinator.start(runId);
  return { adapter, database, service, runId, inspect: () => service.coordinator.inspect(runId) };
}

for (const id of Object.keys(factories) as (keyof typeof factories)[])
  describe(`${id} offline capability preflight`, () => {
    const required = {
      codex: "--json",
      pi: "--mode",
      claude: "--verbose",
      opencode: "--stdio",
      omp: "--approval-mode",
    }[id];
    const requiredHelp = id === "opencode" ? "serve" : "help";
    it("rejects missing required launch features without starting execution", async () => {
      const f = fixture(id, { omit: [required] });
      await assert.rejects(f.create(), /incompatible/);
      assert.equal(f.launched(), 0);
      assert.equal(existsSync(f.capture), false);
    });
    for (const probe of [
      { fail: { version: 7 } },
      { fail: { [requiredHelp]: 9 } },
      { oversize: [requiredHelp] },
    ])
      it(`rejects failed or truncated required probes (${JSON.stringify(probe)})`, async () => {
        const f = fixture(id, probe);
        await assert.rejects(f.create(), /probe failed/);
        assert.equal(f.launched(), 0);
      });
    it("allows supported fresh execution without optional model/resume features", async () => {
      const f = fixture(id, { omit: ["--model"] }, false);
      const s = await service(f, id, workflow(id));
      try {
        assert.equal(s.adapter.capabilities.supportsModelSelection, false);
        assert.equal(s.adapter.capabilities.supportsResume, false);
        assert.equal(s.adapter.resumeForReportCorrection, undefined);
        await s.service.drive(s.runId);
        assert.equal(s.inspect().run.status, "completed");
        assert.equal(f.launched(), 1);
        assert.equal(s.inspect().events.filter((e) => e.type === "correction_requested").length, 0);
      } finally {
        s.database.close();
      }
    });
    it("rejects requested model selection before launch with a useful durable error", async () => {
      const f = fixture(id, { omit: ["--model"] });
      const s = await service(f, id, workflow(id, "    model: provider/model"));
      try {
        assert.throws(
          () => s.adapter.start({ ...input(f.root), model: "provider/model" }),
          AdapterPreflightError,
        );
        await s.service.drive(s.runId);
        const state = s.inspect();
        assert.equal(state.transitions[0]?.outcome, "system.spawn_error");
        assert.match(JSON.stringify(state), /does not support model selection/);
        assert.equal(state.events.filter((e) => e.type === "invocation_started").length, 0);
        assert.equal(f.launched(), 0);
      } finally {
        s.database.close();
      }
    });
    it("rejects a workflow resume when the installed adapter lacks it, without fresh fallback", async () => {
      const f = fixture(id, {}, false);
      const s = await service(f, id, workflow(id, "", true));
      try {
        await s.service.drive(s.runId);
        const state = s.inspect();
        assert.equal(state.transitions.at(-1)?.outcome, "system.resume_unavailable");
        assert.match(JSON.stringify(state), /does not support exact session resume/);
        assert.equal(f.launched(), 1);
        assert.equal(state.events.filter((e) => e.type === "invocation_started").length, 1);
        assert.equal(state.events.filter((e) => e.type === "correction_requested").length, 0);
      } finally {
        s.database.close();
      }
    });
    it("keeps clean missing-report behavior when optional correction resume is unavailable", async () => {
      const f = fixture(id, {}, false, "silent");
      const s = await service(f, id, workflow(id));
      try {
        await s.service.drive(s.runId);
        assert.equal(s.inspect().transitions[0]?.outcome, "system.report_error");
        assert.equal(f.launched(), 1);
        assert.equal(s.inspect().events.filter((e) => e.type === "correction_requested").length, 0);
      } finally {
        s.database.close();
      }
    });
    it("inventory returns the same implemented capabilities as the factory", async () => {
      const f = fixture(id);
      const adapter = await f.create();
      const descriptor = BUILT_IN_HARNESSES.get(id) as HarnessDescriptor;
      const probe = await probeHarness(descriptor, (_binary, args) =>
        runProbeCommand(process.execPath, [...f.settings.prefixArgs, ...args]),
      );
      assert.equal(probe.problem, undefined);
      assert.deepEqual(probe.capabilities, adapter.capabilities);
      assert.equal(probe.capabilities?.supportsEventStream, id !== "opencode");
      assert.equal(
        probe.capabilities?.supportsStructuredFinalOutput,
        false,
        "structured final report fallback is not implemented",
      );
      assert.equal(f.launched(), 0);
    });
    if (id !== "codex")
      it("rejects requested reasoning effort when its optional selector is absent", async () => {
        const flag =
          id === "claude"
            ? "--effort"
            : id === "opencode"
              ? "provider/model#variant"
              : "--thinking";
        const f = fixture(id, { omit: [flag] });
        const s = await service(
          f,
          id,
          workflow(id, "    model: provider/model\n    reasoning_effort: high"),
        );
        try {
          assert.equal(s.adapter.capabilities.supportsReasoningEffort, false);
          await s.service.drive(s.runId);
          assert.equal(s.inspect().transitions[0]?.outcome, "system.spawn_error");
          assert.match(JSON.stringify(s.inspect()), /does not support reasoning effort selection/);
          assert.equal(f.launched(), 0);
        } finally {
          s.database.close();
        }
      });
  });

it("preserves adapter-authored option diagnostics through RunService without exposing arbitrary errors", async () => {
  for (const id of ["pi", "omp", "claude", "opencode"] as const) {
    const f = fixture(id);
    const s = await service(
      f,
      id,
      workflow(
        id,
        id === "opencode" ? "    model: malformed" : "    reasoning_effort: unsupported",
      ),
    );
    try {
      await s.service.drive(s.runId);
      assert.equal(s.inspect().transitions[0]?.outcome, "system.spawn_error");
      assert.match(
        JSON.stringify(s.inspect()),
        id === "opencode"
          ? /model must be provider/
          : id === "claude"
            ? /effort must be/
            : /thinking level is unsupported/,
      );
      assert.equal(f.launched(), 0);
      assert.equal(s.inspect().events.filter((e) => e.type === "correction_requested").length, 0);
    } finally {
      s.database.close();
    }
  }
});

it("failed optional OpenCode probes disable their features without prohibiting fresh work", async () => {
  const f = fixture("opencode", { fail: { session: 9, run: 9 } });
  const s = await service(f, "opencode", workflow("opencode"));
  try {
    assert.equal(s.adapter.capabilities.supportsResume, false);
    assert.equal(s.adapter.capabilities.supportsModelSelection, false);
    await s.service.drive(s.runId);
    assert.equal(s.inspect().run.status, "completed");
  } finally {
    s.database.close();
  }
});

it("OpenCode embedded model variants also require installed reasoning support", async () => {
  const f = fixture("opencode", { omit: ["provider/model#variant"] });
  const s = await service(f, "opencode", workflow("opencode", "    model: provider/model#high"));
  try {
    await s.service.drive(s.runId);
    assert.equal(s.inspect().transitions[0]?.outcome, "system.spawn_error");
    assert.match(JSON.stringify(s.inspect()), /does not support named reasoning variants/);
    assert.equal(f.launched(), 0);
  } finally {
    s.database.close();
  }
});

it("Codex resume model selection is checked separately from fresh model support", async () => {
  const f = fixture("codex");
  const adapter = await createCodexAdapter(f.settings, async (_binary, args) => {
    const r = await runProbeCommand(process.execPath, args);
    return args.includes("resume")
      ? { ...r, stdout: r.stdout.replace("--model", "--model-extra") }
      : r;
  });
  assert.equal(adapter.capabilities.supportsResume, true);
  assert.equal(adapter.capabilities.supportsModelSelection, true);
  assert.throws(
    () =>
      adapter.start({
        ...input(f.root),
        model: "m",
        priorSessionId: "00000000-0000-4000-8000-000000000001",
      }),
    /resume mode does not support model selection/,
  );
  assert.equal(f.launched(), 0);
});

for (const probe of [{ fail: { resume: 9 } }, { oversize: ["resume"] }])
  it(`failed/truncated optional Codex resume evidence still permits fresh execution (${JSON.stringify(probe)})`, async () => {
    const f = fixture("codex", probe);
    const s = await service(f, "codex", workflow("codex"));
    try {
      assert.equal(s.adapter.capabilities.supportsResume, false);
      assert.equal(s.adapter.resumeForReportCorrection, undefined);
      await s.service.drive(s.runId);
      assert.equal(s.inspect().run.status, "completed");
      assert.equal(f.launched(), 1);
    } finally {
      s.database.close();
    }
  });

it("the service honors unavailable resume capability even if a custom correction callback exists", async () => {
  const f = fixture("claude", {}, false, "silent");
  const adapter = await f.create();
  const database = new WorkflowDatabase(":memory:");
  let corrected = false;
  try {
    const service = new RunService(database, {
      agents: new Map([
        [
          "claude",
          {
            id: adapter.id,
            capabilities: adapter.capabilities,
            start: (input: AgentInput) => adapter.start(input),
            resumeForReportCorrection: () => {
              corrected = true;
              throw new Error("must not run");
            },
          },
        ],
      ]),
      logDir: path.join(f.root, "logs"),
    });
    const runId = service.createRun({ workflowText: workflow("claude"), workflowDir: f.root });
    service.coordinator.start(runId);
    await service.drive(runId);
    const state = service.coordinator.inspect(runId);
    assert.equal(state.transitions[0]?.outcome, "system.report_error");
    assert.equal(state.events.filter((e) => e.type === "correction_requested").length, 0);
    assert.equal(corrected, false);
    assert.equal(f.launched(), 1);
  } finally {
    database.close();
  }
});
