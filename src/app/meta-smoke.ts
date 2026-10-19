/** Account-local smoke convenience only; workflow model/provider selection remains unrestricted. */
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseSmokeSelection,
  runHarnessSmoke,
  type SmokeSelection,
  smokePlan,
} from "./harness-smoke.js";

export const META_SMOKE_MODEL = "meta/muse-spark-1.3-contributor";
const VARIABLE = "MUSE_SPARK_API_KEY";
const SOURCE_DESCRIPTION = "~/.config/secrets.zsh:MUSE_SPARK_API_KEY";
const MAX_SOURCE_BYTES = 1024 * 1024;

export class MetaCredentialError extends Error {
  constructor() {
    super(
      "Cannot load MUSE_SPARK_API_KEY from ~/.config/secrets.zsh. Require one nonempty literal assignment in a current-user-owned regular file with no group/other permissions. Shell expansion is not executed. No credential content was logged.",
    );
  }
}

/** Parse only the approved assignment. Never source a shell file or import its other credentials. */
export function loadMetaCredential(file: string): string {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.size > MAX_SOURCE_BYTES ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0
    )
      throw new MetaCredentialError();
    const source = readFileSync(fd, "utf8");
    if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) throw new MetaCredentialError();
    const assignments = source
      .split(/\r?\n/)
      .filter((line) => /^[ \t]*(?:export[ \t]+)?MUSE_SPARK_API_KEY[ \t]*=/.test(line));
    if (assignments.length !== 1) throw new MetaCredentialError();
    const match = assignments[0]?.match(
      /^[ \t]*(?:export[ \t]+)?MUSE_SPARK_API_KEY[ \t]*=[ \t]*(?:'([^'\r\n]*)'|"([^"$`\\\r\n]*)"|([^\s'"$`\\;|&()<>#]+))[ \t]*(?:#.*)?$/,
    );
    const value = match?.[1] ?? match?.[2] ?? match?.[3];
    if (!value?.trim() || /[\0\r\n]/.test(value)) throw new MetaCredentialError();
    return value;
  } catch {
    // Filesystem/parser exceptions must never echo a secret-bearing line or supplied value.
    throw new MetaCredentialError();
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function parseMetaSmokeSelection(args: readonly string[]): SmokeSelection {
  const selection = parseSmokeSelection([
    ...args,
    "--model",
    META_SMOKE_MODEL,
    "--reasoning-effort",
    "low",
  ]);
  assertMetaSelection(selection);
  return selection;
}

function assertMetaSelection(selection: SmokeSelection) {
  if (
    !["omp", "opencode"].includes(selection.harness) ||
    selection.model !== META_SMOKE_MODEL ||
    selection.reasoningEffort !== "low"
  )
    throw new Error(
      "Meta smoke requires omp or opencode with the documented Contributor/low selection",
    );
}

export function metaSmokePlan(selection: SmokeSelection) {
  assertMetaSelection(selection);
  return {
    ...smokePlan(selection),
    credentialSource: SOURCE_DESCRIPTION,
    authentication: "explicit named-secret loading only with --execute; native status unsupported",
    privacy: "Contributor mode permits Meta to use submitted content for model training",
    configuration: "OpenCode project-local Meta Responses provider; no global configuration edits",
  };
}

/** Credential-free OpenCode v2 config. Native normal resources remain enabled. */
function prepareOpenCodeProject(project: string) {
  const configDir = path.join(project, ".opencode");
  mkdirSync(configDir, { mode: 0o700 });
  writeFileSync(
    path.join(configDir, "opencode.json"),
    JSON.stringify({
      providers: {
        meta: {
          name: "Meta Model API",
          env: ["MODEL_API_KEY"],
          package: "@opencode/ai/providers/openai/responses",
          settings: { baseURL: "https://api.meta.ai/v1" },
          models: {
            "muse-spark-1.3-contributor": {
              capabilities: {
                tools: true,
                input: ["text"],
                output: ["text"],
                reasoning: { supported: true, effort: ["low"] },
              },
              limit: { context: 1048576, output: 131072 },
              body: { include: ["reasoning.encrypted_content"] },
              variants: [{ id: "low", body: { reasoning: { effort: "low", summary: "auto" } } }],
            },
          },
        },
      },
    }),
    { mode: 0o600 },
  );
}

type MetaSmokeDependencies = Omit<
  NonNullable<Parameters<typeof runHarnessSmoke>[1]>,
  "prepareProject"
>;

export async function runMetaSmoke(
  selection: SmokeSelection,
  dependencies: MetaSmokeDependencies = {},
) {
  assertMetaSelection(selection);
  if (!selection.execute) throw new Error("Meta credential loading requires explicit --execute");
  const source = dependencies.adapterOptions?.environment ?? process.env;
  const credential = loadMetaCredential(
    path.join(source.HOME ?? os.homedir(), ".config", "secrets.zsh"),
  );
  // No mutation of process.env; only the named file assignment enters the adapter environment.
  const environment: NodeJS.ProcessEnv = { ...source, MODEL_API_KEY: credential };
  delete environment[VARIABLE];
  return runHarnessSmoke(selection, {
    ...dependencies,
    adapterOptions: { ...dependencies.adapterOptions, environment },
    ...(selection.harness === "opencode" ? { prepareProject: prepareOpenCodeProject } : {}),
  });
}
