/** Known injected values only. No auth-file discovery or claim to recognize unknown secrets. */
function secretRepresentations(secrets: readonly string[]): string[] {
  const values = new Set<string>();
  for (const secret of secrets) {
    if (!secret) continue;
    values.add(secret);
    values.add(JSON.stringify(secret).slice(1, -1));
    // URL encoders differ in hex case; do not lowercase the unencoded credential characters.
    const uri = encodeURIComponent(Buffer.from(secret).toString("utf8"));
    values.add(uri);
    values.add(uri.replace(/%[0-9A-F]{2}/g, (encoded) => encoded.toLowerCase()));
    values.add(new URLSearchParams({ v: secret }).toString().slice(2));
    values.add(Buffer.from(secret).toString("base64"));
    values.add(Buffer.from(secret).toString("base64url"));
  }
  return [...values];
}

/** Credentials selected into a child environment, including authorization embedded in URLs. */
export function environmentSecrets(env: NodeJS.ProcessEnv): string[] {
  const secrets: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue;
    if (/KEY|TOKEN|PASSWORD|SECRET/.test(name)) secrets.push(value);
    if (/_URL$/.test(name)) {
      try {
        const url = new URL(value);
        if (url.username || url.password) {
          // A public Basic username alone is not authorization. Treat username-only userinfo as
          // a credential, but do not redact common words like "user" when a password is present.
          const parts = url.password ? [url.password] : [url.username];
          secrets.push(value, ...parts);
          for (const part of parts) {
            try {
              secrets.push(decodeURIComponent(part));
            } catch {
              // A malformed escape does not make its original representation safe to log.
            }
          }
          try {
            // Authorization: Basic encodes the pair, not each component independently.
            secrets.push(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`);
          } catch {
            secrets.push(`${url.username}:${url.password}`);
          }
        }
      } catch {
        // Non-URL configuration is left to the harness.
      }
    }
  }
  return secrets;
}

/**
 * Match original bytes, never replacement text. Masks survive the retained suffix so overlapping
 * values cannot reveal each other's tails. Byte slicing also preserves UTF-8 and invalid evidence.
 */
export class SecretFilter {
  private pending: Buffer = Buffer.alloc(0);
  private mask: Buffer = Buffer.alloc(0);
  private redacting = false;
  private readonly patterns: Buffer[];
  private readonly retain: number;

  constructor(
    secrets: readonly string[],
    private readonly write: (chunk: Buffer) => void,
  ) {
    this.patterns = secretRepresentations(secrets).map((value) => Buffer.from(value));
    this.retain = this.patterns.reduce((max, pattern) => Math.max(max, pattern.length - 1), 0);
  }

  push(chunk: Buffer): void {
    if (!this.patterns.length) {
      this.write(chunk);
      return;
    }
    this.pending = Buffer.concat([this.pending, chunk]);
    this.mask = Buffer.concat([this.mask, Buffer.alloc(chunk.length)]);
    for (const pattern of this.patterns) {
      let start = this.pending.indexOf(pattern);
      while (start !== -1) {
        this.mask.fill(1, start, start + pattern.length);
        start = this.pending.indexOf(pattern, start + 1);
      }
    }
    let count = Math.max(0, this.pending.length - this.retain);
    // Filters can feed a multiplexer. Do not split a valid UTF-8 code point between writes where
    // another channel could insert bytes. Invalid input still passes through unchanged.
    const boundary = count;
    while (count > 0 && ((this.pending[count] ?? 0) & 0xc0) === 0x80 && boundary - count < 3)
      count--;
    this.flush(count);
  }

  end(): void {
    this.flush(this.pending.length);
  }

  private flush(count: number): void {
    const chunks: Buffer[] = [];
    for (let start = 0; start < count; ) {
      const masked = this.mask[start] === 1;
      let end = start + 1;
      while (end < count && (this.mask[end] === 1) === masked) end++;
      if (!masked) chunks.push(this.pending.subarray(start, end));
      else if (!this.redacting) chunks.push(Buffer.from("[redacted]"));
      this.redacting = masked;
      start = end;
    }
    if (chunks.length) this.write(Buffer.concat(chunks));
    this.pending = Buffer.from(this.pending.subarray(count));
    this.mask = Buffer.from(this.mask.subarray(count));
  }
}

export function scrubSecrets(text: string, secrets: readonly string[]): string {
  const chunks: Buffer[] = [];
  const filter = new SecretFilter(secrets, (chunk) => chunks.push(chunk));
  filter.push(Buffer.from(text));
  filter.end();
  return Buffer.concat(chunks).toString("utf8");
}
