/** Claude stream-json evidence, never reports. Only a final result can confirm a completed turn. */
import { StringDecoder } from "node:string_decoder";

export const CLAUDE_EVENT_LINE_LIMIT = 1024 * 1024;
export const isClaudeSessionId = (id: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export class ClaudeEvents {
  private readonly decoder = new StringDecoder("utf8");
  private pending = "";
  private pendingBytes = 0;
  private discarding = false;
  private failed = false;
  private terminal = false;
  private succeeded = false;
  private initialized = false;
  private initialSession: string | undefined;
  private resultSession: string | undefined;
  private unavailable = false;

  get sessionId(): string | undefined {
    return this.resultSession;
  }
  get successful(): boolean {
    return this.terminal && this.succeeded && !this.failed;
  }
  get resumeUnavailable(): boolean {
    return this.unavailable && !this.failed;
  }

  push(chunk: Buffer): void {
    this.consume(this.decoder.write(chunk));
  }
  end(): void {
    this.consume(this.decoder.end());
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
      if (this.pendingBytes > CLAUDE_EVENT_LINE_LIMIT) {
        this.failed = true;
        this.pending = "";
        this.discarding = true;
      }
      if (!this.discarding) this.pending += part;
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
    if (!isRecord(value) || typeof value.type !== "string" || this.terminal) {
      this.failed = true;
      return;
    }
    if (value.type === "system" && value.subtype === "init") {
      if (this.initialized || !this.validSession(value.session_id)) this.failed = true;
      this.initialized = true;
      this.initialSession = typeof value.session_id === "string" ? value.session_id : undefined;
    } else if (value.type === "result") {
      this.terminal = true;
      if (
        !this.validSession(value.session_id) ||
        (this.initialSession !== undefined && this.initialSession !== value.session_id)
      )
        this.failed = true;
      else this.resultSession = value.session_id as string | undefined;
      this.succeeded = value.subtype === "success" && value.is_error === false;
      // Verified installed failure shape. Do not retain provider-authored error text in state.
      this.unavailable =
        value.subtype === "error_during_execution" &&
        value.is_error === true &&
        this.resultSession !== undefined &&
        Array.isArray(value.errors) &&
        value.errors.includes(`No conversation found with session ID: ${this.resultSession}`);
    } else if (value.type === "error") this.failed = true;
    // API retry/progress, assistant/tool content and unknown future events have no control authority.
  }

  private validSession(value: unknown): boolean {
    // Missing identity cannot enable correction; retain clean missing-report behavior shared by adapters.
    return value === undefined || (typeof value === "string" && isClaudeSessionId(value));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
