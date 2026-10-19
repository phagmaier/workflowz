// Synthetic Claude CLI: exercises real argv/stdin/env, exact persisted UUIDs, stream-json and wf.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { probeReply } from "./probe-controls.mjs";

const [configFile, ...args] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configFile, "utf8"));
const flag = (name) => args[args.indexOf(name) + 1];
const event = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
if (args.includes("--version")) {
  probeReply(config, args, "2.1.303 (Claude Code)");
  await new Promise(() => {});
}
if (args.includes("--help")) {
  probeReply(
    config,
    args,
    `--print --input-format text --output-format stream-json --verbose --permission-mode bypassPermissions --model --effort low medium high xhigh max${config.options.supportsResume === false ? "" : " --resume [value]"}`,
  );
  await new Promise(() => {});
}
if (
  !args.includes("--print") ||
  !args.includes("--verbose") ||
  flag("--output-format") !== "stream-json" ||
  flag("--input-format") !== "text" ||
  flag("--permission-mode") !== "bypassPermissions"
)
  throw new Error("invalid Claude invocation");
for (const forbidden of [
  "--continue",
  "--session-id",
  "--fork-session",
  "--no-session-persistence",
  "--bare",
  "--background",
])
  if (args.includes(forbidden)) throw new Error(`unexpected ${forbidden}`);
const index = config.index ?? 0;
config.index = index + 1;
writeFileSync(configFile, JSON.stringify(config));
const script = config.plan[index] ?? { mode: "report", outcome: "complete" };
const isResume = args.includes("--resume");
const id = isResume ? flag("--resume") : randomUUID();
const file = path.join(process.env.CLAUDE_CONFIG_DIR, `${id}.json`);
const identity = config.options.missingSession
  ? {}
  : { session_id: script.mode === "different-session" ? randomUUID() : id };
const terminal = (overrides = {}) =>
  event({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "outcome-looking text has no reporting authority",
    ...identity,
    ...overrides,
  });
if (isResume && (config.options.resumeError || !existsSync(file))) {
  terminal({
    subtype: "error_during_execution",
    is_error: true,
    errors: [`No conversation found with session ID: ${id}`],
  });
  process.exit(1);
}
if (!isResume) writeFileSync(file, JSON.stringify({ persisted: true }));
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
event({ type: "system", subtype: "init", ...identity, permissionMode: "bypassPermissions" });
if (script.mode === "terminal-then-hang") {
  terminal();
  setInterval(() => {}, 1000);
} else if (script.mode === "unavailable-then-hang") {
  terminal({
    subtype: "error_during_execution",
    is_error: true,
    errors: [`No conversation found with session ID: ${id}`],
  });
  setInterval(() => {}, 1000);
} else if (script.mode === "invalid-json") {
  process.stdout.write("malformed\n");
  terminal();
} else if (script.mode === "different-session") {
  terminal();
} else if (script.mode === "leak-credentials") {
  for (const name of ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]) {
    const value = process.env[name] ?? "";
    const line = JSON.stringify({ type: "assistant", message: { content: value } });
    const split = line.indexOf(value) + 5;
    process.stdout.write(line.slice(0, split));
    process.stderr.write(value.slice(0, 5));
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.stdout.write(`${line.slice(split)}\n`);
    process.stderr.write(`${value.slice(5)}\n`);
  }
  terminal();
} else if (script.mode === "large-stream") {
  for (let i = 0; i < 1200; i += 1)
    event({ type: "assistant", message: { content: "a".repeat(1000) } });
  terminal();
} else if (script.mode === "assistant-only") {
  event({ type: "assistant", message: { stop_reason: "end_turn", content: "done" } });
} else if (script.mode === "truncated") {
  process.stdout.write(
    JSON.stringify({ type: "result", subtype: "success", is_error: false, ...identity }),
  );
} else {
  const retried = script.mode === "retry-then-report";
  if (retried) {
    event({
      type: "system",
      subtype: "api_retry",
      attempt: 1,
      max_retries: 3,
      error: "overloaded",
      ...identity,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const mode = retried || script.mode === "report-then-error" ? "report" : script.mode;
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
    event({ type: "assistant", message: { content: [{ type: "text", text: data.toString() }] } }),
  );
  child.stderr.on("data", (data) => process.stderr.write(data));
  const code = await new Promise((resolve) => child.on("close", resolve));
  terminal(
    script.mode === "provider-error" || script.mode === "report-then-error"
      ? { subtype: "error_during_execution", is_error: true, errors: ["offline provider failure"] }
      : {},
  );
  process.exit(code ?? 1);
}
