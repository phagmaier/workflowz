/** Bounded LF-delimited Codex JSONL decoder. Events supply process/session evidence, never reports. */
import { StringDecoder } from "node:string_decoder";

export const CODEX_EVENT_LINE_LIMIT = 1024 * 1024;
export const isCodexSessionId = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export class CodexEvents {
  private readonly decoder = new StringDecoder("utf8");
  private pending = "";
  private pendingBytes = 0;
  private discarding = false;
  private completed = false;
  private failed = false;
  private session: string | undefined;

  get sessionId(): string | undefined {
    return this.session;
  }
  get successful(): boolean {
    return this.completed && !this.failed;
  }

  push(chunk: Buffer): void {
    this.consume(this.decoder.write(chunk));
  }
  end(): void {
    this.consume(this.decoder.end());
    // JSONL records may omit the final LF. A partial/malformed record still fails closed.
    if (this.pending.trim() && !this.discarding) this.record(this.pending);
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
      if (this.pendingBytes > CODEX_EVENT_LINE_LIMIT) {
        this.failed = true;
        this.pending = "";
        this.discarding = true;
      }
      if (!this.discarding) this.pending += part;
    }
  }

  private record(line: string): void {
    try {
      const value: unknown = JSON.parse(line);
      if (
        !value ||
        typeof value !== "object" ||
        !("type" in value) ||
        typeof value.type !== "string"
      ) {
        this.failed = true;
        return;
      }
      if (value.type === "thread.started") {
        const id = "thread_id" in value ? value.thread_id : undefined;
        if (
          typeof id !== "string" ||
          !isCodexSessionId(id) ||
          (this.session !== undefined && this.session !== id)
        )
          this.failed = true;
        else this.session = id;
      } else if (value.type === "turn.completed") {
        this.completed = true;
      } else if (value.type === "turn.failed" || value.type === "error") {
        this.failed = true;
      }
      // Unknown future events and item payloads are retained in the raw log, without control authority.
    } catch {
      this.failed = true;
    }
  }
}
