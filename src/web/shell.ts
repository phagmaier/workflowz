/// <reference lib="dom" />
/** Native browser client; credentials are HttpOnly cookies, all project text stays inert. */
import type { BrowserRequest, BrowserSource } from "../contracts/browser.js";
import type { Diagnostic } from "../contracts/diagnostics.js";
import type { TaskImportPreview } from "../contracts/task-import.js";
import type { RunRow } from "../store/run-store.js";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing UI element ${id}`);
  return node as T;
}
const value = (id: string) => element<HTMLInputElement>(id).value;
const showError = (message: string) => {
  element("error").textContent = message;
  element("error").hidden = !message;
};
function diagnostics(items: Diagnostic[]) {
  return items
    .map(
      (d) =>
        `${d.severity} [${d.code}] ${d.path.join(".")}${d.location ? ` (${d.location.line}:${d.location.column})` : ""}: ${d.message}`,
    )
    .join("\n");
}
let source: BrowserSource | undefined;
let busy = false;
function connected(yes: boolean) {
  element("auth").hidden = yes;
  element("workspace").hidden = !yes;
  element("connection").textContent = yes ? "Connected / localhost" : "Not connected";
}
async function send<T>(route: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(route, {
      method: "POST",
      headers: { "content-type": "application/json", "x-workflowz-ui": "1" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error(
      "Daemon unavailable or request timed out. Check the foreground daemon, then refresh. A timed-out save/create may have committed: inspect lists before repeating it.",
    );
  }
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) connected(false);
    throw new Error(
      [
        result.error ?? `HTTP ${response.status}`,
        result.diagnostics ? diagnostics(result.diagnostics) : "",
        result.issues
          ? result.issues
              .map((i: { path: string[]; message: string }) => `${i.path.join(".")}: ${i.message}`)
              .join("\n")
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result as T;
}
const api = <T>(request: BrowserRequest) => send<T>("/ui/api", request);
async function action(work: () => Promise<void>) {
  if (busy) return;
  busy = true;
  showError("");
  element("message").textContent = "";
  const buttons = [...document.querySelectorAll("button")];
  for (const button of buttons) button.disabled = true;
  try {
    await work();
  } catch (error) {
    showError(error instanceof Error ? error.message : "Operation failed");
  } finally {
    busy = false;
    for (const button of buttons) button.disabled = false;
  }
}
interface Saved {
  revisionId: number;
  name: string;
  sourceDir: string;
  sha256: string;
}
async function refresh() {
  const saved = await api<Saved[]>({ op: "workflows" });
  const selected = value("saved");
  const select = element<HTMLSelectElement>("saved");
  select.replaceChildren(new Option("Select a saved workflow…", ""));
  for (const revision of saved)
    select.add(
      new Option(
        `${revision.name} — r${revision.revisionId} · ${revision.sourceDir} · ${revision.sha256.slice(0, 12)}`,
        String(revision.revisionId),
      ),
    );
  if (saved.some((revision) => String(revision.revisionId) === selected)) select.value = selected;
  const runs = await api<RunRow[]>({ op: "runs" });
  const body = element("runs");
  body.replaceChildren();
  for (const run of runs) {
    const row = document.createElement("tr");
    for (const text of [
      run.runId,
      run.status,
      run.projectRoot,
      `r${run.revisionId}`,
      run.cursorStepId,
      run.createdAt,
    ]) {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.append(cell);
    }
    body.append(row);
  }
  element("empty-runs").hidden = runs.length > 0;
}
function clearPreview() {
  element("preview").replaceChildren();
  element("preview-summary").textContent =
    "Inputs changed. Preview again before importing; creation always rereads the source.";
}
async function load(next: BrowserSource) {
  const loaded = await api<{
    name: string;
    workflowDir: string;
    projectRoot: string;
    instructions: string[];
    taskPath: string | null;
    diagnostics: Diagnostic[];
  }>({ op: "load", source: next });
  source = next;
  element<HTMLInputElement>("project-root").value = loaded.projectRoot;
  element<HTMLTextAreaElement>("instructions").value = loaded.instructions.join("\n");
  element<HTMLInputElement>("task-path").value = loaded.taskPath ?? "";
  element<HTMLInputElement>("include-completed").checked = false;
  element<HTMLFieldSetElement>("input-fields").disabled = false;
  element("source-label").textContent =
    `${loaded.name} · ${"revisionId" in next ? `saved r${next.revisionId}` : "uploaded file"} · ${loaded.workflowDir}`;
  clearPreview();
  element("message").textContent = diagnostics(loaded.diagnostics);
}
function selection(op: "preview" | "save" | "create"): BrowserRequest {
  if (!source) throw new Error("Load a workflow first");
  return {
    op,
    source,
    projectRoot: value("project-root").trim(),
    instructions: value("instructions")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    taskPath: value("task-path").trim() || null,
    includeCompleted: element<HTMLInputElement>("include-completed").checked,
  };
}

element("pair-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void action(async () => {
    const code = value("code").trim();
    element<HTMLInputElement>("code").value = "";
    await send("/ui/pair", { code });
    connected(true);
    await refresh();
  });
});
element("refresh").addEventListener("click", () => {
  void action(refresh);
});
element("logout").addEventListener("click", () => {
  void action(async () => {
    await api({ op: "logout" });
    connected(false);
  });
});
element("load-saved").addEventListener("click", () => {
  void action(async () => {
    if (!value("saved")) throw new Error("Select a saved revision first");
    await load({ revisionId: Number(value("saved")) });
  });
});
element("upload-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void action(async () => {
    const file = element<HTMLInputElement>("workflow-file").files?.[0];
    if (!file) throw new Error("Select a YAML workflow file");
    if (file.size > 1024 * 1024) throw new Error("Workflow file exceeds 1 MiB");
    await load({ workflowText: await file.text(), workflowDir: value("workflow-dir").trim() });
  });
});
element("inputs-form").addEventListener("input", clearPreview);
element("inputs-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void action(async () => {
    clearPreview();
    const preview = await api<TaskImportPreview | null>(selection("preview"));
    element("preview-summary").textContent = preview
      ? `${preview.total} checkboxes · ${preview.prechecked} prechecked · ${preview.runnableCount} runnable. Preview only; no run created.`
      : "No task source. This is a graph-only workflow. No run created.";
    if (!preview) return;
    const runnable = new Set(preview.runnable.map((t) => t.sourceOrder));
    for (const task of preview.tasks) {
      const item = document.createElement("article");
      item.className = "task";
      for (const text of [
        `${runnable.has(task.sourceOrder) ? "Queued" : "Excluded"} · line ${task.sourceLine} · ${task.headingPath.join(" / ")}`,
        `${task.sourceChecked ? "[x]" : "[ ]"} ${task.title}`,
        task.body,
      ]) {
        if (!text) continue;
        const p = document.createElement("p");
        p.textContent = text;
        item.append(p);
      }
      element("preview").append(item);
    }
  });
});
element("save").addEventListener("click", () => {
  void action(async () => {
    const result = await api<{ revisionId: number; diagnostics: Diagnostic[] }>(selection("save"));
    element("message").textContent =
      `Saved immutable revision r${result.revisionId}. No run created. ${diagnostics(result.diagnostics)}`;
    await refresh();
    element<HTMLSelectElement>("saved").value = String(result.revisionId);
  });
});
element("create").addEventListener("click", () => {
  void action(async () => {
    const result = await api<{ runId: string }>(selection("create"));
    element("message").textContent =
      `Created ready run ${result.runId}. Tasks frozen from the current source. Execution has not started.`;
    await refresh();
  });
});
void action(async () => {
  await api({ op: "session" });
  connected(true);
  await refresh();
});
