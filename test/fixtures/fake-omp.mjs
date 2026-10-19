// Synthetic omp 18.12.2 boundary: print JSON differs from Pi; no agent_settled event.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [configFile, ...args] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configFile, "utf8"));
const flag = (name) => args[args.indexOf(name) + 1];
const event = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
if (args.includes("--version")) {
  console.log("omp/18.12.2");
  process.exit(0);
}
if (args.includes("--help")) {
  console.log(
    `--print --mode=json,rpc --model=<model> --thinking=<level> --session-dir=<dir> --approval-mode=always-ask|write|yolo${config.options.supportsResume === false ? "" : " --resume=<id|path>"}`,
  );
  process.exit(0);
}
const index = config.index ?? 0;
config.index = index + 1;
writeFileSync(configFile, JSON.stringify(config));
const script = config.plan[index] ?? { mode: "report", outcome: "complete" };
const isResume = args.includes("--resume");
const timestamp = new Date().toISOString();
const id = randomUUID();
const file = isResume
  ? flag("--resume")
  : path.join(flag("--session-dir"), `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`);
// Simulates deletion after the adapter's precheck, before the CLI's strict open.
if (isResume && script.mode === "deleted-at-admission") rmSync(file);
if (isResume && (config.options.resumeError || !existsSync(file))) {
  console.error(`Session "${file}" not found.`);
  process.exit(1);
}
const header = isResume
  ? JSON.parse(readFileSync(file, "utf8").split("\n")[1])
  : { type: "session", version: 3, id, timestamp, cwd: process.cwd() };
if (!isResume && script.mode !== "unpersisted-session")
  writeFileSync(
    file,
    `${JSON.stringify({ type: "title", v: 1, title: "fixture", updatedAt: timestamp, pad: "" }).padEnd(255, " ")}\n${JSON.stringify(header)}\n`,
  );
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
  event(
    script.mode === "different-session"
      ? { ...header, id: randomUUID() }
      : script.mode === "wrong-cwd"
        ? { ...header, cwd: "/different/project" }
        : header,
  );
const message = (stopReason) => ({
  role: "assistant",
  content: [{ type: "text", text: "🙂\u2028\u2029 content has no report authority" }],
  stopReason,
});
const terminal = (stopReason = "stop") => {
  event({ type: "message_end", message: message(stopReason) });
  event({ type: "agent_end", messages: [message(stopReason)], isTerminal: true, yielded: true });
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
event({ type: "agent_start" });
if (script.mode === "terminal-then-hang") {
  terminal();
  setInterval(() => {}, 1000);
} else if (script.mode === "leak-provider") {
  const secret = process.env.OPENAI_API_KEY;
  process.stdout.write(`{"type":"notice","level":"info","message":"${secret.slice(0, 12)}`);
  await wait(30);
  process.stdout.write(`${secret.slice(12)} ${process.env.OMP_AUTH_BROKER_TOKEN}"}\n`);
  process.stderr.write(`${secret} ${process.env.OMP_AUTH_BROKER_TOKEN}\n`);
  terminal();
} else if (script.mode === "invalid-json") {
  process.stdout.write("malformed\n");
  terminal();
} else if (script.mode === "truncated") {
  terminal();
  process.stdout.write('{"type":"notice"');
} else if (script.mode === "pi-settled") {
  event({ type: "message_end", message: message("stop") });
  event({ type: "agent_settled", aborted: false });
} else if (script.mode === "end-only" || script.mode === "nonterminal-end") {
  event({
    type: "agent_end",
    messages: [message("stop")],
    ...(script.mode === "nonterminal-end"
      ? { isTerminal: false, yielded: true, awaitingAsyncWork: true }
      : {}),
  });
} else if (script.mode === "large-stream") {
  for (let i = 0; i < 1200; i += 1)
    event({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "a".repeat(1000) },
    });
  terminal();
} else if (["different-session", "wrong-cwd", "unpersisted-session"].includes(script.mode)) {
  terminal();
} else {
  const retried = script.mode.startsWith("retry-");
  const compacted = script.mode.startsWith("compaction-");
  if (retried || compacted) {
    event({ type: "message_end", message: message("error") });
    if (retried)
      event({
        type: "auto_retry_start",
        attempt: 1,
        maxAttempts: 3,
        delayMs: 150,
        errorMessage: "overloaded",
      });
    else event({ type: "auto_compaction_start", reason: "overflow", action: "context-full" });
    event({ type: "agent_end", messages: [message("error")], isTerminal: false, yielded: false });
    await wait(150);
    if (compacted)
      event({
        type: "auto_compaction_end",
        aborted: false,
        willRetry: true,
        action: "context-full",
      });
    event({ type: "agent_start" });
  }
  const mode =
    script.mode.endsWith("-then-report") || script.mode === "report-then-abort"
      ? "report"
      : (retried || compacted) && script.mode.endsWith("-then-hang")
        ? "hang"
        : script.mode === "compaction-error"
          ? "silent"
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
  if (retried || failed) event({ type: "auto_retry_end", success: !failed, attempt: 2 });
  if (script.mode === "compaction-error")
    event({
      type: "auto_compaction_end",
      aborted: false,
      willRetry: false,
      errorMessage: "compaction failed",
    });
  terminal(failed ? "error" : script.mode === "report-then-abort" ? "aborted" : "stop");
  process.exit(code ?? 1);
}
