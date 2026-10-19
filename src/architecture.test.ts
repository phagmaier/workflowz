/**
 * Module-boundary checks (todo 0.3, AGENTS "keep workflow control logic pure"). These fail the
 * build when an import crosses a boundary, so the rules hold without relying on review.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { REPO_ROOT } from "./test-support/paths.js";

const SRC = path.join(REPO_ROOT, "src");
const IMPORT_PATTERN =
  /(?:import|export)\s[^'"`]*?from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;

interface SourceFile {
  readonly relative: string;
  readonly imports: readonly string[];
}

function sourceFiles(directory: string = SRC): SourceFile[] {
  const files: SourceFile[] = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts")) {
      const text = readFileSync(full, "utf8");
      const imports = [...text.matchAll(IMPORT_PATTERN)].map(
        (match) => match[1] ?? match[2] ?? match[3] ?? "",
      );
      files.push({ relative: path.relative(SRC, full), imports });
    }
  }
  return files;
}

/** Production modules only; tests and test helpers may reach across boundaries. */
function productionFiles(): SourceFile[] {
  return sourceFiles().filter(
    (file) => !file.relative.endsWith(".test.ts") && !file.relative.startsWith("test-support"),
  );
}

const PURE_BUILTINS = new Set(["node:crypto", "node:path"]);
const PROCESS_OR_IO =
  /^(node:)?(child_process|fs|fs\/promises|net|http|https|os|worker_threads|cluster|dgram|dns|tls)$/;

describe("module boundaries", () => {
  it("contracts import only sibling contract modules, zod, yaml, and pure built-ins", () => {
    for (const file of productionFiles().filter((f) => f.relative.startsWith("contracts/"))) {
      for (const specifier of file.imports) {
        const allowed =
          specifier.startsWith("./") ||
          specifier === "zod" ||
          specifier === "yaml" ||
          PURE_BUILTINS.has(specifier);
        assert.ok(
          allowed,
          `${file.relative} imports '${specifier}', which is outside the contract layer`,
        );
      }
    }
  });

  it("engine imports contracts, its own modules, and the harness registry data only", () => {
    for (const file of productionFiles().filter((f) => f.relative.startsWith("engine/"))) {
      for (const specifier of file.imports) {
        const ok =
          specifier.startsWith("./") ||
          specifier.startsWith("../contracts/") ||
          specifier === "../adapters/harness-registry.js" ||
          PURE_BUILTINS.has(specifier);
        assert.ok(
          ok,
          `${file.relative} imports '${specifier}'; the engine may use only contracts and harness-registry data`,
        );
      }
    }
  });

  it("only the adapter probe and the app layer may touch processes or the filesystem", () => {
    for (const file of productionFiles()) {
      if (file.relative.startsWith("app/") || file.relative === path.join("adapters", "probe.ts")) {
        continue;
      }
      for (const specifier of file.imports) {
        assert.ok(!PROCESS_OR_IO.test(specifier), `${file.relative} imports '${specifier}'`);
      }
    }
  });

  it("the engine never imports adapters' process code or the app layer", () => {
    for (const file of productionFiles().filter((f) => f.relative.startsWith("engine/"))) {
      for (const specifier of file.imports) {
        assert.ok(!specifier.includes("/app/"), `${file.relative} imports the app layer`);
        assert.ok(!specifier.includes("probe"), `${file.relative} imports the probe`);
      }
    }
  });
});
