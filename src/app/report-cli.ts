/** wf report is synchronous from the caller's perspective: success means durable acknowledgment. */
import { closeSync, openSync, readSync } from "node:fs";
import { request } from "node:http";
import { REPORT_BODY_LIMIT, REPORT_LIMITS, validateReport } from "../contracts/report.js";

function fileText(file: string, max: number): string {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(max + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = readSync(fd, buffer, size, buffer.length - size, null);
      if (!read) break;
      size += read;
    }
    if (size > max) throw new Error("handoff file exceeds 64 KiB");
    return buffer.subarray(0, size).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

async function main(): Promise<void> {
  const [command, outcome, ...args] = process.argv.slice(2);
  if (command !== "report" || !outcome)
    throw new Error(
      "usage: wf report <outcome> --summary <text> [--issue <text>] [--handoff-file <path>] [--data <JSON object>]",
    );
  const fields: Record<string, unknown> = { outcome };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index] ?? "";
    const value = args[index + 1];
    if (
      !["--summary", "--issue", "--handoff-file", "--data"].includes(flag) ||
      value === undefined ||
      seen.has(flag)
    ) {
      throw new Error("unknown, duplicate, or missing report option");
    }
    seen.add(flag);
    if (flag === "--handoff-file") fields["handoff"] = fileText(value, REPORT_LIMITS.handoff);
    else if (flag === "--data") {
      try {
        fields["data"] = JSON.parse(value);
      } catch {
        throw new Error("--data must be a JSON object");
      }
    } else fields[flag.slice(2)] = value;
  }
  const report = validateReport(fields, [outcome]); // Server independently enforces declared outcomes.
  const endpoint = process.env["WF_REPORT_ENDPOINT"];
  const token = process.env["WF_REPORT_TOKEN"];
  if (!endpoint || !token)
    throw new Error("report environment is unavailable; launch from an active workflow attempt");
  const url = new URL(endpoint);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/internal/reports" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("report endpoint must be the private loopback route");
  const body = JSON.stringify(report);
  if (Buffer.byteLength(body) > REPORT_BODY_LIMIT) throw new Error("report is too large");
  const response = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let text = "";
        res.on("data", (chunk: Buffer) => {
          text += chunk.toString("utf8");
          if (text.length > 8192) req.destroy(new Error("oversized acknowledgment"));
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 500, text }));
        res.on("error", reject);
      },
    );
    req.setTimeout(5000, () => req.destroy(new Error("acknowledgment timeout")));
    req.on("error", () =>
      reject(new Error("report endpoint unavailable or acknowledgment timed out")),
    );
    req.end(body);
  });
  if (response.status !== 201) {
    let message = "submission rejected";
    try {
      message = String((JSON.parse(response.text) as { error?: string }).error ?? message);
    } catch {
      /* generic error */
    }
    throw new Error(`report rejected (${response.status}): ${message}`);
  }
  console.log("report accepted");
}

try {
  await main();
} catch (error) {
  // Do not print arguments, endpoints, tokens, file contents, or raw transport errors.
  let message = error instanceof Error ? error.message : "report failed";
  const token = process.env["WF_REPORT_TOKEN"];
  if (token) message = message.replaceAll(token, "[redacted]");
  console.error(message);
  process.exitCode = 1;
}
