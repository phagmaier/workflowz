import { copyFileSync } from "node:fs";

// TypeScript emits shell.js; only inert HTML/CSS need copying.
for (const file of ["shell.html", "shell.css"]) {
  copyFileSync(
    new URL(`../src/web/${file}`, import.meta.url),
    new URL(`../dist/web/${file}`, import.meta.url),
  );
}
