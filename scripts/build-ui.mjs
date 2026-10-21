// Builds the browser app and records the exact files the daemon may serve under /ui/.
import { readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = path.join(root, "dist/ui-app");
// TypeScript doesn't remove outputs of deleted sources from an existing checkout.
rmSync(path.join(root, "dist/web"), { recursive: true, force: true });
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
await build({ configFile: path.join(root, "ui/vite.config.ts"), logLevel: "warn" });

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(path.relative(out, full).split(path.sep).join("/"));
  }
};
walk(out);
const list = files.sort().map((file) => {
  const type = TYPES[path.extname(file)];
  if (!type) throw new Error(`unexpected browser build output ${file}`);
  return { path: file, type };
});
if (!list.some((entry) => entry.path === "index.html")) throw new Error("index.html not built");
writeFileSync(path.join(out, "asset-list.json"), `${JSON.stringify(list, null, 2)}\n`);
