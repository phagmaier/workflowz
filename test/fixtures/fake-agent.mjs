// Offline harness: all authoritative reporting uses the real wf CLI and loopback channel.
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const [mode = "report", outcome = "complete", extra = ""] = process.argv.slice(2);
const note = (text) => {
  if (process.env.FAKE_AGENT_LOG) appendFileSync(process.env.FAKE_AGENT_LOG, `${text}\n`);
};
const session = process.env.FAKE_SESSION;
if (session) {
  if (process.env.FAKE_RESUME === "1") {
    JSON.parse(readFileSync(session, "utf8")); // A resume must find the persisted session.
    if (
      process.env.FAKE_CORRECTION === "1" &&
      !process.env.FAKE_PROMPT.includes("Do not modify source files")
    )
      throw new Error("unsafe correction prompt");
  } else writeFileSync(session, JSON.stringify({ persisted: true }));
}
const report = async (value = outcome) => {
  // Direct adapter process tests without a report channel have no reporting authority.
  if (!process.env.WF_REPORT_ENDPOINT) return;
  const child = spawn("wf", ["report", value, "--summary", "Fake agent result"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (data) => process.stdout.write(data));
  child.stderr.on("data", (data) => process.stderr.write(data));
  const code = await new Promise((resolve) => child.on("close", resolve));
  note(`ack ${code}`);
};
const finish = (code) => {
  note(`end ${process.pid}`);
  process.exit(code);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const forever = () => setInterval(() => {}, 1000);
note(`start ${process.pid} ${mode}`);
if (process.env.FAKE_CORRECTION === "1") note(`correction ${session ?? "missing"}`);
switch (mode) {
  case "report":
    await report();
    finish(0);
    break;
  case "duplicate":
    await report();
    await report();
    finish(0);
    break;
  case "invalid-then-valid":
    await report("bogus");
    await report();
    finish(0);
    break;
  case "report-then-crash":
    await report();
    finish(3);
    break;
  case "provider-error":
  case "silent":
    finish(0);
    break;
  case "crash":
    finish(3);
    break;
  case "delay":
    await wait(Number(extra) || 200);
    await report();
    finish(0);
    break;
  case "report-then-delay":
    await report();
    await wait(Number(extra) || 300);
    finish(0);
    break;
  case "report-then-hang":
    await report();
    forever();
    break;
  case "leak-token": {
    const token = process.env.WF_REPORT_TOKEN ?? "";
    process.stdout.write(token.slice(0, 20));
    await wait(30);
    process.stdout.write(`${token.slice(20)}\n`);
    process.stderr.write(`${token}\n`);
    await report();
    finish(0);
    break;
  }
  case "hang":
    forever();
    break;
  case "hang-with-child": {
    const child = spawn("sleep", ["60"], { stdio: "ignore" });
    writeFileSync(extra, String(child.pid));
    forever();
    break;
  }
  default:
    finish(2);
}
