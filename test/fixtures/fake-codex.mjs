// Offline Codex CLI boundary. Real adapter argv/stdin/env, JSONL and wf reports; no provider access.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [configFile, ...args] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configFile, "utf8"));
const isResume = args[1] === "resume";
const event = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const help =
  "--json --model --config --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox stdin SESSION_ID";
if (args.includes("--version")) {
  console.log("codex-cli 0.163.0");
  process.exit(0);
}
if (args.includes("--help")) {
  console.log(config.options.supportsResume === false && isResume ? "unavailable" : help);
  process.exit(0);
}
const index = config.index ?? 0;
config.index = index + 1;
writeFileSync(configFile, JSON.stringify(config));
const script = config.plan[index] ?? { mode: "report", outcome: "complete" };
const correction = isResume && index > 0;
const sessionId = isResume ? args.at(-2) : randomUUID();
const sessionFile = path.join(path.dirname(configFile), `${sessionId}.json`);
if (isResume && (config.options.resumeError || !existsSync(sessionFile))) {
  event({ type: "error", message: "session unavailable" });
  process.exit(1);
}
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const prompt = Buffer.concat(chunks).toString("utf8");
if (config.capture)
  writeFileSync(
    config.capture,
    JSON.stringify({
      args,
      prompt,
      cwd: process.cwd(),
      env: Object.fromEntries(
        Object.entries(process.env).map(([key, value]) => [
          key,
          /KEY|TOKEN|SECRET/.test(key) ? "[present]" : value,
        ]),
      ),
    }),
  );
if (!config.options.missingSession)
  event({
    type: "thread.started",
    thread_id: script.mode === "different-session" ? randomUUID() : sessionId,
  });
event({ type: "turn.started" });
event({
  type: "item.completed",
  item: { type: "agent_message", text: "This is an early message, not settlement" },
});
if (script.mode === "different-session") {
  event({ type: "turn.completed" });
} else if (script.mode === "terminal-then-hang") {
  event({ type: "turn.completed" });
  setInterval(() => {}, 1000);
} else if (script.mode === "wrong-session") {
  event({ type: "thread.started", thread_id: randomUUID() });
  event({ type: "turn.completed" });
} else if (script.mode === "invalid-json") {
  process.stdout.write("malformed\n");
  event({ type: "turn.completed" });
} else if (script.mode === "large-stream") {
  for (let i = 0; i < 1200; i += 1)
    event({ type: "item.completed", item: { text: "a".repeat(1000) } });
  event({ type: "turn.completed" });
} else {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("fake-agent.mjs", import.meta.url)),
      script.mode,
      script.outcome ?? "complete",
      script.extra ?? "",
    ],
    {
      env: {
        ...process.env,
        FAKE_SESSION: sessionFile,
        FAKE_RESUME: isResume ? "1" : "0",
        FAKE_CORRECTION: correction ? "1" : "0",
        FAKE_PROMPT: prompt,
        ...(config.options.logFile ? { FAKE_AGENT_LOG: config.options.logFile } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (data) =>
    event({ type: "item.completed", item: { type: "agent_message", text: data.toString() } }),
  );
  child.stderr.on("data", (data) => process.stderr.write(data));
  const code = await new Promise((resolve) => child.on("close", resolve));
  if (script.mode === "provider-error")
    event({ type: "turn.failed", error: { message: "offline provider failure" } });
  else if (code === 0) event({ type: "turn.completed", usage: { output_tokens: 1 } });
  process.exit(code ?? 1);
}
