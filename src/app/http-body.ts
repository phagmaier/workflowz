import type { IncomingMessage } from "node:http";

export class HttpRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  req.setTimeout(5000, () => req.destroy());
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk as Buffer);
    size += bytes.length;
    if (size > 2 * 1024 * 1024) throw new HttpRequestError(413, "request body exceeds 2 MiB");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpRequestError(422, "request body must be valid JSON");
  }
}
