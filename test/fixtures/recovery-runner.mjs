// Offline fault injection only: real service/processes, no installed harness or provider.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { RunService } from "../../dist/runner/run-service.js";
import { WorkflowDatabase } from "../../dist/store/database.js";
import { ScriptedAgentAdapter } from "../../dist/test-support/scripted-agent.js";

const [root, scenario] = process.argv.slice(2);
const marker = path.join(root, "effects");
const database = new WorkflowDatabase(path.join(root, "state.sqlite"));
if (scenario === "termination-request" || scenario === "termination-finish") {
  const recovering = new RunService(database, {
    agents: new Map(),
    logDir: path.join(root, "logs"),
  });
  const runId = database.prepare("SELECT run_id FROM runs LIMIT 1").get().run_id;
  const method =
    scenario === "termination-request" ? "requestRecoveryTermination" : "finishRecoveryTermination";
  const original = recovering.coordinator[method].bind(recovering.coordinator);
  recovering.coordinator[method] = (...args) => {
    const result = scenario === "termination-request" ? original(...args) : undefined;
    process.send({ runId });
    process.kill(process.pid, "SIGSTOP");
    return result;
  };
  const state = recovering.recovery(runId);
  await recovering.terminateRecovery(runId, {
    expectedEventId: state.expectedEventId,
    attemptId: state.attempt.attemptId,
    reason: "Explicit fixture recovery termination",
  });
  throw new Error("fault injection unexpectedly continued");
}
const adapter = new ScriptedAgentAdapter(
  scenario === "correction"
    ? [{ mode: "silent" }, { mode: "report-then-hang" }]
    : scenario === "correction-intent"
      ? [{ mode: "silent" }]
      : [{ mode: "report-then-hang" }],
  { logFile: path.join(root, "agent.log") },
);
const service = new RunService(database, {
  agents: new Map([["codex", adapter]]),
  logDir: path.join(root, "logs"),
});
const command = `${scenario === "stubborn" ? "process.on('SIGTERM', () => {});" : ""}const fs = require('node:fs'); fs.appendFileSync(${JSON.stringify(marker)}, 'effect\\n');
if (fs.readFileSync(${JSON.stringify(marker)}, 'utf8') === 'effect\\n') setInterval(() => {}, 1000);`;
const commandScenario = scenario === "command" || scenario === "stubborn" || scenario === "between";
const commandStep = `kind: command\n    argv: ${JSON.stringify([process.execPath, "-e", scenario === "between" ? `require('node:fs').appendFileSync(${JSON.stringify(marker)}, 'effect\\n')` : command])}`;
const agentStep =
  "kind: agent\n    harness: codex\n    session: fresh\n    prompt: Offline recovery fixture\n    outcomes: [complete]";
const runId = service.createRun({
  workflowDir: root,
  workflowText: `version: 1
name: Recovery fixture
project:
  root: .
start: work
steps:
  work:
    ${commandScenario ? commandStep : agentStep}
    on:
      complete: { goto: done }${commandScenario ? "\n      failed: { pause: true }" : ""}
  done:
    kind: end
`,
});
const stopAtBoundary = () => {
  process.send({ runId });
  process.kill(process.pid, "SIGSTOP");
};
if (scenario === "between") {
  const settle = service.coordinator.settle.bind(service.coordinator);
  service.coordinator.settle = (...args) => {
    const result = settle(...args);
    stopAtBoundary();
    return result;
  };
}
if (scenario === "correction-intent") {
  const prepare = service.coordinator.prepareInvocation.bind(service.coordinator);
  service.coordinator.prepareInvocation = (...args) => {
    prepare(...args);
    if (args[1] === 1) stopAtBoundary();
  };
}
service.coordinator.start(runId);
const ready = setInterval(() => {
  if (scenario === "between") return; // Only the post-commit hook may announce this boundary.
  const state = service.coordinator.inspect(runId);
  const attempt = state.attempts[0];
  if (!attempt?.processIdentity) return;
  if (commandScenario && (!existsSync(marker) || readFileSync(marker, "utf8") !== "effect\n"))
    return;
  if (!commandScenario && !service.coordinator.reportFor(attempt.attemptId)) return;
  clearInterval(ready);
  process.send({ runId });
}, 10);
await service.drive(runId);
