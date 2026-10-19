// Test-only stand-in for an agent harness. Behavior is chosen by argv: <mode> <outcome> <extra>.
// Each run appends "start <pid> <mode>" and "end <pid>" to $FAKE_AGENT_LOG, so tests can prove that
// no two attempts ever overlap.
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";

const [mode = "report", outcome = "complete", extra = ""] = process.argv.slice(2);
const logFile = process.env.FAKE_AGENT_LOG;
const note = (text) => {
  if (logFile) {
    appendFileSync(logFile, `${text}\n`);
  }
};
const report = () => process.stdout.write(`OUTCOME ${outcome}\n`);
const finish = (code) => {
  note(`end ${process.pid}`);
  process.exit(code);
};
const forever = () => setInterval(() => {}, 1000);

note(`start ${process.pid} ${mode}`);
switch (mode) {
  case "report":
    report();
    finish(0);
    break;
  case "report-then-crash":
    report();
    finish(3);
    break;
  case "silent":
    finish(0);
    break;
  case "crash":
    finish(3);
    break;
  case "delay":
    setTimeout(() => {
      report();
      finish(0);
    }, Number(extra) || 200);
    break;
  case "hang":
    forever();
    break;
  case "hang-with-child": {
    // Inherits this process group, so terminating the attempt must end the child as well.
    const child = spawn("sleep", ["60"], { stdio: "ignore" });
    writeFileSync(extra, String(child.pid));
    forever();
    break;
  }
  default:
    finish(2);
}
