/** Pi JSON mode evidence. LF alone frames records; low-level agent_end never settles a run. */
import { StringDecoder } from "node:string_decoder";

export const PI_EVENT_LINE_LIMIT = 1024 * 1024;
export const isPiSessionId = (id: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export interface PiSessionHeader {
  readonly type: "session";
  readonly version: 3;
  readonly id: string;
  readonly cwd: string;
  readonly timestamp: string;
}

export function isPiSessionHeader(value: unknown): value is PiSessionHeader {
  return (
    isRecord(value) &&
    value.type === "session" &&
    value.version === 3 &&
    typeof value.id === "string" &&
    isPiSessionId(value.id) &&
    typeof value.cwd === "string" &&
    typeof value.timestamp === "string" &&
    Number.isFinite(Date.parse(value.timestamp))
  );
}

export class PiEvents {
  private readonly decoder = new StringDecoder("utf8");
  private pending = "";
  private pendingBytes = 0;
  private discarding = false;
  private failed = false;
  private settled = false;
  private assistantFailed = false;
  private retryFailed = false;
  private retrying = false;
  private compactionFailed = false;
  private header: PiSessionHeader | undefined;

  get session(): PiSessionHeader | undefined {
    return this.header;
  }
  get successful(): boolean {
    return (
      this.settled &&
      !this.failed &&
      !this.assistantFailed &&
      !this.retryFailed &&
      !this.retrying &&
      !this.compactionFailed
    );
  }

  push(chunk: Buffer): void {
    this.consume(this.decoder.write(chunk));
  }
  end(): void {
    this.consume(this.decoder.end());
    // The installed protocol requires LF termination. A truncated last record is not evidence.
    if (this.pending.length || this.discarding) this.failed = true;
    this.pending = "";
  }

  private consume(text: string): void {
    for (const [index, part] of text.split("\n").entries()) {
      if (index > 0) {
        if (!this.discarding && this.pending.trim()) this.record(this.pending);
        this.pending = "";
        this.pendingBytes = 0;
        this.discarding = false;
      }
      this.pendingBytes += Buffer.byteLength(part);
      if (this.pendingBytes > PI_EVENT_LINE_LIMIT) {
        this.failed = true;
        this.pending = "";
        this.discarding = true;
      }
      if (!this.discarding) this.pending += part;
    }
  }

  private assistant(message: unknown): void {
    if (isRecord(message) && message.role === "assistant") {
      // A transient failed message may recover inside Pi's own retry/overflow loop.
      this.assistantFailed = !["stop", "toolUse"].includes(String(message.stopReason));
    }
  }

  private record(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.failed = true;
      return;
    }
    if (!isRecord(value) || typeof value.type !== "string") {
      this.failed = true;
      return;
    }
    switch (value.type) {
      case "session":
        if (!isPiSessionHeader(value) || this.header) this.failed = true;
        else this.header = value;
        break;
      case "agent_start":
      case "turn_start":
      case "message_start":
      case "tool_execution_start":
      case "compaction_start":
      case "summarization_retry_scheduled":
      case "summarization_retry_attempt_start":
        this.settled = false;
        break;
      case "message_end":
      case "turn_end":
        this.settled = false;
        this.assistant(value.message);
        break;
      case "message_update":
        if (isRecord(value.assistantMessageEvent)) {
          if (value.assistantMessageEvent.type === "error") this.assistantFailed = true;
          else if (value.assistantMessageEvent.type === "done")
            this.assistant(value.assistantMessageEvent.message);
        }
        break;
      case "agent_end":
        this.settled = false;
        if (Array.isArray(value.messages))
          for (const message of value.messages) this.assistant(message);
        break;
      case "auto_retry_start":
        this.settled = false;
        this.retrying = true;
        this.retryFailed = false;
        break;
      case "auto_retry_end":
        this.retrying = false;
        this.retryFailed = value.success !== true;
        break;
      case "compaction_end":
        this.compactionFailed = value.aborted === true || typeof value.errorMessage === "string";
        break;
      case "queue_update":
        if (
          (Array.isArray(value.steering) && value.steering.length) ||
          (Array.isArray(value.followUp) && value.followUp.length)
        )
          this.settled = false;
        break;
      case "agent_settled":
        this.settled = value.aborted === false;
        break;
      case "error":
      case "extension_error":
        this.failed = true;
        break;
      // Unknown future events and tool/content payloads have no reporting authority.
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
