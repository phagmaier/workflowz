/** Exact-host/origin browser boundary. No management or report credential is accepted here. */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { browserPairSchema, browserRequestSchema } from "../contracts/browser.js";
import { BrowserService } from "./browser-service.js";
import { HttpRequestError, readJsonBody } from "./http-body.js";
import type { ManagementService } from "./management-service.js";

const assets: Record<string, { type: string; file: string }> = {
  "/ui/": { type: "text/html; charset=utf-8", file: "shell.html" },
  "/ui/shell.js": { type: "text/javascript; charset=utf-8", file: "shell.js" },
  "/ui/editor.js": { type: "text/javascript; charset=utf-8", file: "editor.js" },
  "/ui/dashboard.js": { type: "text/javascript; charset=utf-8", file: "dashboard.js" },
  "/ui/intervention.js": { type: "text/javascript; charset=utf-8", file: "intervention.js" },
  "/ui/shell.css": { type: "text/css; charset=utf-8", file: "shell.css" },
};
const APP_PREFIX = "/ui/app/";
const APP_TYPES = new Set([
  "text/html; charset=utf-8",
  "text/javascript; charset=utf-8",
  "text/css; charset=utf-8",
  "image/svg+xml",
  "font/woff2",
]);
// Plain relative segments only: no leading dot, so no "..", hidden files or absolute paths.
const APP_PATH = /^(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
export type AppAssets = ReadonlyMap<string, { type: string; body: Buffer }>;

/** Reads the build-time allowlist once; requests can only select an exact listed URL. */
export function loadAppAssets(directory: URL): AppAssets {
  let listed: unknown;
  try {
    listed = JSON.parse(readFileSync(new URL("asset-list.json", directory), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  if (!Array.isArray(listed)) throw new Error("browser asset list must be an array");
  const assets = new Map<string, { type: string; body: Buffer }>();
  for (const entry of listed as unknown[]) {
    const { path, type } = (entry ?? {}) as { path?: unknown; type?: unknown };
    if (typeof path !== "string" || !APP_PATH.test(path) || path === "asset-list.json")
      throw new Error(`invalid browser asset path ${JSON.stringify(path)}`);
    if (typeof type !== "string" || !APP_TYPES.has(type))
      throw new Error(`invalid browser asset type for ${path}`);
    const url = path === "index.html" ? APP_PREFIX : `${APP_PREFIX}${path}`;
    if (assets.has(url)) throw new Error(`duplicate browser asset ${path}`);
    assets.set(url, { type, body: readFileSync(new URL(path, directory)) });
  }
  return assets;
}
let builtApp: AppAssets | undefined;
const secret = () => randomBytes(32).toString("hex");
function equal(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class BrowserTransport {
  private pairing: { code: string; expires: number } | undefined;
  private session: { token: string; expires: number } | undefined;
  private readonly service: BrowserService;

  constructor(
    management: ManagementService,
    private readonly now = Date.now,
  ) {
    this.service = new BrowserService(management);
  }

  access(port: number) {
    this.pairing = { code: secret(), expires: this.now() + 5 * 60_000 };
    return { url: `http://127.0.0.1:${port}/ui/`, code: this.pairing.code, expiresInSeconds: 300 };
  }

  async receive(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!req.url?.startsWith("/ui/")) return false;
    res.setHeader("cache-control", "no-store");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader(
      "content-security-policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    const host = `127.0.0.1:${req.socket.localPort}`;
    if (req.headers.host !== host)
      throw new HttpRequestError(403, "browser requires exact loopback Host");
    const asset = Object.hasOwn(assets, req.url) ? assets[req.url] : undefined;
    if (req.method === "GET" && asset) {
      res.writeHead(200, { "content-type": asset.type });
      res.end(readFileSync(new URL(`../web/${asset.file}`, import.meta.url)));
      return true;
    }
    if (req.method === "GET" && req.url.startsWith(APP_PREFIX)) {
      builtApp ??= loadAppAssets(new URL("../ui-app/", import.meta.url));
      const file = builtApp.get(req.url);
      if (!file) throw new HttpRequestError(404, "unknown browser route");
      res.writeHead(200, { "content-type": file.type });
      res.end(file.body);
      return true;
    }
    if (req.method !== "POST" || (req.url !== "/ui/pair" && req.url !== "/ui/api"))
      throw new HttpRequestError(404, "unknown browser route");
    if (
      req.headers.origin !== `http://${host}` ||
      req.headers["x-workflowz-ui"] !== "1" ||
      req.headers["content-type"]?.split(";")[0] !== "application/json"
    )
      throw new HttpRequestError(403, "browser requires same-origin JSON and request header");
    const cookieName = `wf_ui_${req.socket.localPort}`;
    const cookie = (value: string, maxAge: number) =>
      `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/ui; Max-Age=${maxAge}`;
    const reply = (body: unknown) => {
      res.writeHead(200, { "content-type": "application/json", connection: "close" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/ui/pair") {
      const { code } = browserPairSchema.parse(await readJsonBody(req));
      if (!this.pairing || this.now() >= this.pairing.expires || !equal(code, this.pairing.code))
        throw new HttpRequestError(
          401,
          "invalid or expired pairing code; run wf ui for a new code",
        );
      this.pairing = undefined;
      this.session = { token: secret(), expires: this.now() + 12 * 60 * 60_000 };
      res.setHeader("set-cookie", cookie(this.session.token, 12 * 60 * 60));
      reply({ paired: true });
      return true;
    }
    const supplied =
      req.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1) ?? "";
    const authorize = () => {
      if (
        !this.session ||
        this.now() >= this.session.expires ||
        !equal(supplied, this.session.token)
      )
        throw new HttpRequestError(401, "browser session expired; run wf ui and pair again");
    };
    authorize();
    const body = await readJsonBody(req);
    // Logout, expiry or pairing may revoke authority while a request body is arriving.
    authorize();
    const request = browserRequestSchema.parse(body);
    if (request.op === "logout") {
      this.session = undefined;
      res.setHeader("set-cookie", cookie("", 0));
      reply({ loggedOut: true });
    } else reply(await this.service.handle(request));
    return true;
  }
}
