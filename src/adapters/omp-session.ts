/** omp v3 journals may start with a title slot. Moved-away copies must not auto-fork on resume. */
import { closeSync, openSync, readSync } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { isPiSessionHeader, type PiSessionHeader } from "./pi-events.js";

/** Bounded records, not bounded transcripts. Only the header and transfer metadata are retained. */
export function readOmpSession(file: string): PiSessionHeader | undefined {
  if (!path.isAbsolute(file) || !file.endsWith(".jsonl")) return undefined;
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const bytes = Buffer.alloc(16384);
    const decoder = new StringDecoder("utf8");
    let pending = "";
    let header: PiSessionHeader | undefined;
    let first = true;
    let departed = false;
    for (;;) {
      const count = readSync(fd, bytes, 0, bytes.length, null);
      const text = count ? decoder.write(bytes.subarray(0, count)) : decoder.end();
      const lines = (pending + text).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (Buffer.byteLength(line) > 1024 * 1024) return undefined;
        const value: unknown = JSON.parse(line);
        if (!header) {
          if (first && isRecord(value) && value.type === "title" && value.v === 1) {
            first = false;
            continue;
          }
          if (!isPiSessionHeader(value) || !path.basename(file).endsWith(`_${value.id}.jsonl`))
            return undefined;
          header = value;
        } else if (
          isRecord(value) &&
          value.type === "custom_message" &&
          value.customType === "session-transfer" &&
          isRecord(value.details)
        ) {
          const details = value.details;
          // Match the CLI's last valid transfer marker, independently of the active branch.
          if (details.kind === "departed" && typeof details.to === "string") departed = true;
          else if (
            (details.kind === "arrived" &&
              typeof details.fromCwd === "string" &&
              typeof details.cwd === "string") ||
            (details.kind === "forked" &&
              typeof details.source === "string" &&
              typeof details.to === "string")
          )
            departed = false;
        }
        first = false;
      }
      if (Buffer.byteLength(pending) > 1024 * 1024) return undefined;
      if (!count) return pending.trim() || departed ? undefined : header;
    }
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
