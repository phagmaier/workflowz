// Synthetic earendil Pi CLI boundary: real argv/stdin/env, persisted headers, JSONL and wf reports.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boundaryEvidence } from "./boundary-controls.mjs";
import { probeReply } from "./probe-controls.mjs";

const [configFile, ...args] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configFile, "utf8"));
const flag = (name) => args[args.indexOf(name) + 1];
const event = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
if (args.includes("--version")) {
  probeReply(config, args, "1.3.0");
  await new Promise(() => {});
}
if (args.includes("--help")) {
  probeReply(
    config,
    args,
    `--print --mode json rpc --model --thinking --session-dir <dir>${config.options.supportsResume === false ? "" : " --session <path|id>"}`,
  );
  await new Promise(() => {});
}
const index = config.index ?? 0;
config.index = index + 1;
writeFileSync(configFile, JSON.stringify(config));
const script = config.plan[index] ?? { mode: "report", outcome: "complete" };
const isResume = args.includes("--session");
const timestamp = new Date().toISOString();
const id = randomUUID();
const resumeFile = isResume
  ? readdirSync(flag("--session-dir")).find((name) => name.endsWith(`_${flag("--session")}.jsonl`))
  : undefined;
const file = isResume
  ? path.join(flag("--session-dir"), resumeFile ?? "missing.jsonl")
  : path.join(flag("--session-dir"), `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`);
if (isResume && (config.options.resumeError || !existsSync(file))) {
  console.error("session unavailable");
  process.exit(1);
}
const header = isResume
  ? JSON.parse(readFileSync(file, "utf8").split("\n")[0])
  : { type: "session", version: 3, id, timestamp, cwd: process.cwd() };
if (!isResume && script.mode !== "unpersisted-session")
  writeFileSync(
    file,
    `${JSON.stringify(header)}\n${JSON.stringify({ type: "message", message: { role: "user", content: "fixture" } })}\n`,
  );
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const prompt = Buffer.concat(chunks).toString("utf8");
await boundaryEvidence(config);
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
  event(script.mode === "different-session" ? { ...header, id: randomUUID() } : header);
event({ type: "agent_start" });
const message = (stopReason) => ({
  role: "assistant",
  content: [
    { type: "text", text: "🙂\u2028\u2029 complete-looking content has no reporting authority" },
  ],
  stopReason,
});
const settled = () => event({ type: "agent_settled", aborted: false });
if (script.mode === "terminal-then-hang") {
  settled();
  setInterval(() => {}, 1000);
} else if (script.mode === "invalid-json") {
  process.stdout.write("malformed\n");
  settled();
} else if (script.mode === "different-session" || script.mode === "unpersisted-session") {
  settled();
} else if (script.mode === "large-stream") {
  for (let i = 0; i < 1200; i += 1)
    event({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "a".repeat(1000) },
    });
  event({ type: "message_end", message: message("stop") });
  settled();
} else if (script.mode === "end-only") {
  event({ type: "agent_end", messages: [message("stop")], willRetry: false });
} else {
  const retried = script.mode === "retry-then-report" || script.mode === "retry-then-hang";
  if (retried) {
    event({ type: "message_end", message: message("error") });
    event({ type: "agent_end", messages: [message("error")], willRetry: true });
    event({
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 150,
      errorMessage: "overloaded",
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    event({ type: "agent_start" });
  }
  const mode =
    script.mode === "retry-then-report"
      ? "report"
      : script.mode === "retry-then-hang"
        ? "hang"
        : script.mode === "report-then-abort"
          ? "report"
          : script.mode;
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("fake-agent.mjs", import.meta.url)),
      mode,
      script.outcome ?? "complete",
      script.extra ?? "",
    ],
    {
      env: {
        ...process.env,
        FAKE_SESSION: `${file}.fake.json`,
        FAKE_RESUME: isResume ? "1" : "0",
        FAKE_CORRECTION: isResume && index > 0 ? "1" : "0",
        FAKE_PROMPT: prompt,
        ...(config.options.logFile ? { FAKE_AGENT_LOG: config.options.logFile } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (data) =>
    event({ type: "tool_execution_update", partialResult: { text: data.toString() } }),
  );
  child.stderr.on("data", (data) => process.stderr.write(data));
  const code = await new Promise((resolve) => child.on("close", resolve));
  const failed = script.mode === "provider-error";
  event({ type: "message_end", message: message(failed ? "error" : "stop") });
  event({ type: "agent_end", messages: [message(failed ? "error" : "stop")], willRetry: false });
  if (retried || failed)
    event({
      type: "auto_retry_end",
      success: !failed,
      attempt: 2,
      ...(failed ? { finalError: "offline provider failure" } : {}),
    });
  event({ type: "agent_settled", aborted: script.mode === "report-then-abort" });
  process.exit(code ?? 1);
}
