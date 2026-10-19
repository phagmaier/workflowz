// Independent service smoke through real adapters and synthetic processes; never a provider call.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClaudeAdapter } from "../dist/adapters/claude.js";
import { createOpenCodeAdapter } from "../dist/adapters/opencode.js";
import { RunService } from "../dist/runner/run-service.js";
import { WorkflowDatabase } from "../dist/store/database.js";

const root = mkdtempSync(path.join(os.tmpdir(), "wf-boundary-smoke-"));
const credential = 'synthetic-smoke-"key\\/ +🙂';
try {
  for (const [id, create, configName, authName] of [
    ["opencode", createOpenCodeAdapter, "OPENCODE_CONFIG_DIR", "ANTHROPIC_AUTH_TOKEN"],
    ["claude", createClaudeAdapter, "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN"],
  ]) {
    for (const failure of [false, true]) {
      const name = `${id}-${failure ? "failure" : "correction"}`;
      const config = path.join(root, `${name}.json`);
      const capture = path.join(root, `${name}-env.json`);
      const dbPath = path.join(root, `${name}.sqlite`);
      const logDir = path.join(root, `${name}-logs`);
      writeFileSync(
        config,
        JSON.stringify({
          plan: failure ? [{ mode: "provider-error" }] : [{ mode: "silent" }, { mode: "report" }],
          capture,
          options: { boundary: true, boundaryLarge: true },
        }),
      );
      const adapter = await create({
        binary: process.execPath,
        prefixArgs: [
          fileURLToPath(new URL(`../test/fixtures/fake-${id}.mjs`, import.meta.url)),
          config,
        ],
        environment: {
          PATH: process.env.PATH,
          HOME: root,
          [configName]: root,
          [authName]: credential,
          GITHUB_TOKEN: "withheld",
          NODE_OPTIONS: "--invalid-parent-flag",
        },
      });
      const tokens = [];
      const wrap = (launch) => (input) => {
        tokens.push(input.reportAccess.token);
        for (const token of tokens) assert.ok(input.reportAccess.secrets.includes(token));
        return launch(input);
      };
      const wrapped = {
        id,
        capabilities: adapter.capabilities,
        start: wrap((input) => adapter.start(input)),
        resumeForReportCorrection: wrap((input) => adapter.resumeForReportCorrection(input)),
      };
      const database = new WorkflowDatabase(dbPath);
      let runId;
      const expected = failure ? "system.process_error" : "complete";
      try {
        const service = new RunService(database, { agents: new Map([[id, wrapped]]), logDir });
        runId = service.createRun({
          workflowDir: root,
          workflowText: `version: 1
name: boundary smoke
project: {root: .}
start: work
steps:
  work:
    kind: agent
    harness: ${id}
    session: fresh
    prompt: offline reporting fixture
    outcomes: [complete]
    on: {complete: {goto: done}}
  done: {kind: end}
`,
        });
        service.coordinator.start(runId);
        await service.drive(runId);
        const state = service.coordinator.inspect(runId);
        assert.equal(state.transitions.at(-1).outcome, expected);
        assert.equal(
          state.events.filter((e) => e.type === "correction_requested").length,
          failure ? 0 : 1,
        );
        const starts = state.events.filter((e) => e.type === "invocation_started");
        const settled = state.events.filter((e) => e.type === "invocation_settled");
        assert.equal(starts.length, failure ? 1 : 2);
        assert.equal(settled.length, starts.length);
        for (let index = 0; index < starts.length; index++) {
          assert.ok(starts[index].eventId < settled[index].eventId);
          if (index > 0) assert.ok(settled[index - 1].eventId < starts[index].eventId);
        }
        const logs = readdirSync(logDir).filter(
          (f) => f.endsWith(".log") || f.endsWith(".log.correction"),
        );
        assert.equal(logs.length, failure ? 1 : 2);
        const raw = logs.map((f) => readFileSync(path.join(logDir, f), "utf8")).join("\n");
        assert.match(raw, /boundary_evidence/);
        assert.match(raw, /\[redacted\]/);
        assert.doesNotMatch(raw, /synthetic-|c3ludGhldGlj|b3BlbmNvZGU6/);
        for (const text of [raw, JSON.stringify(state)]) {
          for (const value of [credential, ...tokens])
            for (const form of [
              value,
              JSON.stringify(value).slice(1, -1),
              encodeURIComponent(value),
              Buffer.from(value).toString("base64"),
              Buffer.from(value).toString("base64url"),
            ])
              assert.equal(
                text.includes(form),
                false,
                "credential representation survived scrubbing",
              );
        }
        for (const event of state.events.filter((e) => e.type === "invocation_settled")) {
          assert.match(event.data.diagnostics.stderr, /offline boundary diagnostic:/);
          assert.match(event.data.diagnostics.stderr, /credential submission rejected: 422/);
          assert.ok(Buffer.byteLength(event.data.diagnostics.stderr) <= 4096);
          assert.equal(event.data.diagnostics.stderrTruncated, true);
        }
        const { env } = JSON.parse(readFileSync(capture, "utf8"));
        assert.equal(env.GITHUB_TOKEN, undefined);
        assert.equal(env.NODE_OPTIONS, undefined);
        assert.equal(env[authName], "[present]");
      } finally {
        database.close();
      }
      const reopened = new WorkflowDatabase(dbPath);
      try {
        const service = new RunService(reopened, { agents: new Map([[id, adapter]]), logDir });
        const state = service.coordinator.inspect(runId);
        assert.equal(state.transitions.at(-1).outcome, expected);
        assert.equal(
          state.events.filter((e) => e.type === "report_accepted").length,
          failure ? 0 : 1,
        );
        assert.equal(Boolean(service.coordinator.reportFor(state.attempts[0].attemptId)), !failure);
      } finally {
        reopened.close();
      }
      console.log(
        `${name}: ${expected}; scrubbed logs/diagnostics, selected environment, sequential settlement and SQLite reopen passed`,
      );
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
