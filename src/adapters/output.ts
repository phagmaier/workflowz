/**
 * Bounded capture of a child's stdout. The head is kept (up to `limit` bytes) because it is the part
 * that `{{steps.<id>.stdout}}` interpolates. Anything beyond the limit is dropped and flagged, so
 * memory use stays fixed however much a command prints. Full output goes to the log file.
 */
export class OutputCapture {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  private dropped = false;

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    const room = this.limit - this.size;
    if (room <= 0) {
      this.dropped = true;
      return;
    }
    const kept = chunk.subarray(0, room);
    this.chunks.push(kept);
    this.size += kept.length;
    if (kept.length < chunk.length) {
      this.dropped = true;
    }
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }

  truncated(): boolean {
    return this.dropped;
  }
}

/** Diagnostic text uses a UTF-8 byte bound without manufacturing a partial-code-point replacement. */
export function boundedText(value: string, limit: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(value);
  let end = Math.min(bytes.length, limit);
  while (end > 0 && end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
  return { text: bytes.subarray(0, end).toString("utf8"), truncated: bytes.length > limit };
}
