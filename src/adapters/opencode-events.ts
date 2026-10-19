/** Private bridge protocol, not provider reports. API success still requires process settlement. */
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";

export const OPENCODE_RECORD_LIMIT = 1024 * 1024;
export const openCodeSessionId = z.string().regex(/^ses_[A-Za-z0-9_-]{1,128}$/);
export const isOpenCodeSessionId = (id: string): boolean => openCodeSessionId.safeParse(id).success;
const bridgeEvent = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("session"), sessionID: openCodeSessionId }),
  z.strictObject({
    type: z.literal("result"),
    sessionID: openCodeSessionId,
    outcome: z.enum(["succeeded", "failed", "interrupted"]),
  }),
  z.strictObject({
    type: z.literal("error"),
    kind: z.enum(["resume_unavailable", "spawn_error", "protocol_error"]),
    code: z.string().optional(),
  }),
]);

export class OpenCodeEvents {
  private readonly decoder = new StringDecoder("utf8");
  private pending = "";
  private bytes = 0;
  private discarding = false;
  private failed = false;
  private terminal = false;
  private succeeded = false;
  sessionId: string | undefined;
  resumeUnavailable = false;
  spawnError: string | undefined;

  get successful(): boolean {
    return this.terminal && this.succeeded && !this.failed;
  }
  push(chunk: Buffer): void {
    this.consume(this.decoder.write(chunk));
  }
  end(): void {
    this.consume(this.decoder.end());
    if (this.pending.length || this.discarding) this.failed = true;
  }
  private consume(text: string): void {
    for (const [index, part] of text.split("\n").entries()) {
      if (index > 0) {
        if (!this.discarding && this.pending.trim()) this.record(this.pending);
        this.pending = "";
        this.bytes = 0;
        this.discarding = false;
      }
      this.bytes += Buffer.byteLength(part);
      if (this.bytes > OPENCODE_RECORD_LIMIT) {
        this.failed = true;
        this.pending = "";
        this.discarding = true;
      }
      if (!this.discarding) this.pending += part;
    }
  }
  private record(line: string): void {
    let value: z.infer<typeof bridgeEvent>;
    try {
      value = bridgeEvent.parse(JSON.parse(line));
    } catch {
      this.failed = true;
      return;
    }
    if (this.terminal) {
      this.failed = true;
      return;
    }
    if (value.type === "session") {
      if (this.sessionId !== undefined) this.failed = true;
      else this.sessionId = value.sessionID;
    } else if (value.type === "result") {
      this.terminal = true;
      this.succeeded =
        this.sessionId !== undefined &&
        value.sessionID === this.sessionId &&
        value.outcome === "succeeded";
    } else if (value.type === "error") {
      this.terminal = true;
      this.resumeUnavailable = value.kind === "resume_unavailable";
      if (value.kind === "spawn_error") this.spawnError = value.code;
    } else this.failed = true;
  }
}
