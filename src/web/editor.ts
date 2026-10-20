/// <reference lib="dom" />
/** The server's parsed document is the visual model; unvalidated text always wins. */
import type { BrowserDraft } from "../app/browser-service.js";
import type { BrowserRequest } from "../contracts/browser.js";
import type {
  PolicyDeclaration,
  WorkflowDocument,
  WorkflowStep,
} from "../contracts/workflow-schema.js";

type MutableDocument = Omit<WorkflowDocument, "steps"> & { steps: Record<string, WorkflowStep> };
type TransitionMap = NonNullable<Exclude<WorkflowStep, { kind: "end" }>["on"]>;
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
};
function input(parent: HTMLElement, label: string, initial = "", multiline = false) {
  const wrapper = node("label", label);
  const control = multiline ? node("textarea") : node("input");
  control.value = initial;
  if (multiline) (control as HTMLTextAreaElement).rows = 3;
  wrapper.append(control);
  parent.append(wrapper);
  return control;
}
function select(parent: HTMLElement, label: string, options: readonly string[], initial: string) {
  const wrapper = node("label", label);
  const control = node("select");
  for (const option of new Set([...options, initial])) control.add(new Option(option, option));
  control.value = initial;
  wrapper.append(control);
  parent.append(wrapper);
  return control;
}
function button(parent: HTMLElement, label: string, click: () => void) {
  const control = node("button", label);
  control.type = "button";
  control.addEventListener("click", click);
  parent.append(control);
  return control;
}
const lines = (text: string) =>
  text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export class WorkflowEditor {
  private draft: BrowserDraft | undefined;
  private generation = 0;
  private current = false;
  private selected = "";
  private run: { runId: string; expectedEventId: number } | undefined;
  private readonly yaml = document.getElementById("yaml") as HTMLTextAreaElement;
  private readonly fields = document.getElementById("visual-fields") as HTMLFieldSetElement;
  constructor(
    private readonly api: <T>(request: BrowserRequest) => Promise<T>,
    private readonly action: (work: () => Promise<void>) => Promise<void>,
    private readonly changed: (draft: BrowserDraft) => void,
    private readonly dirty: () => void,
    private readonly synchronized: () => void,
  ) {
    this.yaml.addEventListener("input", () => {
      this.generation++;
      this.current = false;
      this.fields.disabled = true;
      this.status(
        "Unvalidated YAML. Validate to refresh visual controls and effective transitions.",
      );
      this.dirty();
      this.sync();
    });
    document.getElementById("validate-draft")?.addEventListener("click", () => {
      void this.action(() => this.validate());
    });
  }
  private status(text: string) {
    const status = document.getElementById("draft-status");
    if (status) status.textContent = text;
  }
  sync() {
    this.fields.disabled = !this.current || !this.draft?.document;
    for (const id of ["save", "create", "preview-tasks"]) {
      const control = document.getElementById(id) as HTMLButtonElement;
      control.disabled = !this.valid || !!this.run;
    }
    (document.getElementById("input-fields") as HTMLFieldSetElement).disabled =
      this.fields.disabled;
    this.synchronized();
  }
  get valid() {
    return this.current && !!this.draft?.valid;
  }
  get source() {
    if (!this.draft) throw new Error("Load or create a workflow first");
    return { workflowText: this.yaml.value, workflowDir: this.draft.workflowDir };
  }
  requireValid() {
    if (!this.current || !this.draft?.valid)
      throw new Error("Validate and correct the current draft before saving or creating a run");
    return this.source;
  }
  bindRun(run?: { runId: string; expectedEventId: number }) {
    this.run = run;
    this.generation++;
    this.current = false;
    this.sync();
  }
  async open(workflowText: string, workflowDir: string) {
    this.generation++;
    this.yaml.value = workflowText;
    this.draft = {
      workflowText,
      workflowDir,
      document: null,
      valid: false,
      diagnostics: [],
      projectRoot: null,
      transitions: {},
      systemOutcomes: [],
    };
    this.current = false;
    this.sync();
    await this.validate();
  }
  async validate(model?: MutableDocument) {
    const version = this.generation;
    const source = this.source;
    const result = await this.api<BrowserDraft>({
      op: "draft",
      ...source,
      ...(model ? { model } : {}),
      ...(this.run ? { run: this.run } : {}),
    });
    if (version !== this.generation || this.yaml.value !== source.workflowText) return;
    this.draft = result;
    // Do not reset the caret/selection when validating untouched text.
    if (this.yaml.value !== result.workflowText) this.yaml.value = result.workflowText;
    this.current = true;
    this.status(
      result.valid
        ? "Valid draft. Preview/validation created no run or revision."
        : "Invalid draft — save/create blocked. Correct YAML or available visual fields, then validate.",
    );
    const messages = document.getElementById("draft-diagnostics");
    if (messages)
      messages.textContent = result.diagnostics
        .map(
          (d) =>
            `${d.severity} [${d.code}] ${d.path.join(".")}${d.location ? ` (${d.location.line}:${d.location.column})` : ""}: ${d.message}`,
        )
        .join("\n");
    this.changed(result);
    this.render();
    this.sync();
  }
  private mutate(change: (model: MutableDocument) => void) {
    void this.action(async () => {
      if (!this.current || !this.draft?.document)
        throw new Error("Validate YAML before visual editing");
      const model = structuredClone(this.draft.document) as MutableDocument;
      change(model);
      this.dirty();
      await this.validate(model);
    });
  }
  project(projectRoot: string, instructions: string[], taskPath: string | null) {
    this.mutate((model) => {
      model.project = { root: projectRoot, instructions };
      if (taskPath) model.tasks = { source: { kind: "markdown_checklist", path: taskPath } };
      else delete model.tasks;
    });
  }
  private transitions(
    parent: HTMLElement,
    map: TransitionMap,
    outcomes: readonly string[],
    commit: (map: TransitionMap) => void,
  ) {
    const container = node("div");
    parent.append(container);
    const ids = Object.keys(this.draft?.document?.steps ?? {});
    for (const [outcome, action] of Object.entries(map)) {
      const row = node("div");
      row.className = "transition-row";
      row.append(node("strong", outcome));
      const kind = select(
        row,
        "Action",
        ["goto", "pause", "retry"],
        "goto" in action ? "goto" : "retry" in action ? "retry" : "pause",
      );
      const target = select(row, "Target ID", ids, "goto" in action ? action.goto : (ids[0] ?? ""));
      const max = input(
        row,
        "Total attempts (2–100)",
        "retry" in action ? String(action.retry.max_attempts) : "2",
      );
      const backoff = input(
        row,
        "Backoff seconds",
        "retry" in action ? String(action.retry.backoff_seconds) : "0",
      );
      const visibility = () => {
        target.parentElement?.toggleAttribute("hidden", kind.value !== "goto");
        max.parentElement?.toggleAttribute("hidden", kind.value !== "retry");
        backoff.parentElement?.toggleAttribute("hidden", kind.value !== "retry");
      };
      kind.addEventListener("change", visibility);
      visibility();
      button(row, "Apply transition", () =>
        commit({
          ...map,
          [outcome]:
            kind.value === "goto"
              ? { goto: target.value }
              : kind.value === "pause"
                ? { pause: true }
                : {
                    retry: {
                      max_attempts: Number(max.value),
                      backoff_seconds: Number(backoff.value),
                    },
                  },
        }),
      );
      button(row, "Remove rule / inherit", () => {
        const next = { ...map };
        delete next[outcome];
        commit(next);
      });
      container.append(row);
    }
    const add = node("div");
    add.className = "actions";
    const outcome = input(add, "Outcome to add", "");
    const list = node("datalist");
    list.id = `outcomes-${document.querySelectorAll("datalist").length}`;
    for (const name of new Set([...outcomes, ...(this.draft?.systemOutcomes ?? [])]))
      list.append(new Option(name, name));
    outcome.setAttribute("list", list.id);
    add.append(list);
    button(add, "Add pause rule", () => {
      if (!outcome.value.trim()) {
        void this.action(async () => {
          throw new Error("Enter an outcome name");
        });
        return;
      }
      commit({ ...map, [outcome.value.trim()]: { pause: true } });
    });
    parent.append(add);
  }
  private render() {
    this.fields.replaceChildren();
    const model = this.draft?.document;
    if (!model) return;
    const ids = Object.keys(model.steps);
    if (!Object.hasOwn(model.steps, this.selected)) this.selected = ids[0] ?? "";
    const header = node("div");
    header.className = "editor-grid";
    const name = input(header, "Workflow name", model.name);
    const start = select(header, "Start step ID (not display order)", ids, model.start);
    button(header, "Apply name / start", () =>
      this.mutate((m) => {
        m.name = name.value;
        m.start = start.value;
      }),
    );
    this.fields.append(header);
    const stages = node("div");
    stages.className = "editor-grid";
    const list = node("div");
    list.append(node("h3", "Stages · display order only"));
    for (const [index, id] of ids.entries()) {
      const row = node("div");
      row.className = "stage-row";
      button(row, `${id} · ${model.steps[id]?.kind}${id === model.start ? " · START" : ""}`, () => {
        this.selected = id;
        this.render();
        this.sync();
      });
      for (const [label, offset] of [
        ["↑", -1],
        ["↓", 1],
      ] as const) {
        const move = button(row, `${label} ${id}`, () =>
          this.mutate((m) => {
            const entries = Object.entries(m.steps);
            const other = index + offset;
            const item = entries[index];
            const adjacent = entries[other];
            if (item && adjacent) {
              entries[index] = adjacent;
              entries[other] = item;
              m.steps = Object.fromEntries(entries);
            }
          }),
        );
        move.disabled = index + offset < 0 || index + offset >= ids.length;
      }
      list.append(row);
    }
    const id = input(list, "New stable step ID");
    const kind = select(
      list,
      "New step kind",
      ["agent", "command", "task.next", "task.complete", "end"],
      "agent",
    );
    button(list, "Add stage", () =>
      this.mutate((m) => {
        if (!/^[a-z][a-z0-9_]{0,63}$/.test(id.value) || Object.hasOwn(m.steps, id.value))
          throw new Error(
            "Choose a unique stable step ID (lowercase snake_case, up to 64 characters)",
          );
        const step: WorkflowStep =
          kind.value === "agent"
            ? {
                kind: "agent",
                harness: "codex",
                session: "fresh",
                prompt: "Describe the work here",
                outcomes: ["complete"],
              }
            : kind.value === "command"
              ? { kind: "command", argv: ["echo", "Configure this command"] }
              : kind.value === "end"
                ? { kind: "end" }
                : { kind: kind.value as "task.next" | "task.complete" };
        m.steps[id.value] = step;
        this.selected = id.value;
      }),
    );
    const detail = node("div");
    this.stage(detail, this.selected, model.steps[this.selected]);
    stages.append(list, detail);
    this.fields.append(stages);
    this.policies(model);
  }
  private stage(parent: HTMLElement, id: string, step: WorkflowStep | undefined) {
    if (!step) return;
    parent.append(node("h3", `${id} · ${step.kind}`));
    parent.append(
      node(
        "p",
        "IDs remain stable. Removing a referenced stage leaves diagnostics; references are never silently repaired.",
      ),
    );
    button(parent, "Remove selected stage", () =>
      this.mutate((m) => {
        delete m.steps[id];
      }),
    );
    if (step.kind === "end") {
      const label = input(parent, "End label", step.label ?? "");
      button(parent, "Apply stage fields", () =>
        this.mutate((m) => {
          m.steps[id] = label.value ? { kind: "end", label: label.value } : { kind: "end" };
        }),
      );
      parent.append(node("p", "Terminal end: no outcomes or outgoing transitions."));
      return;
    }
    const tags = input(parent, "Tags — one per line", step.tags?.join("\n") ?? "", true);
    const controls = new Map<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>();
    if (step.kind === "agent" || step.kind === "command") {
      controls.set(
        "cwd",
        input(parent, "Working directory (blank = project root)", step.cwd ?? ""),
      );
      controls.set(
        "timeout_seconds",
        input(parent, "Timeout seconds (optional)", step.timeout_seconds?.toString() ?? ""),
      );
    }
    if (step.kind === "agent") {
      for (const key of ["harness", "model", "reasoning_effort"] as const)
        controls.set(key, input(parent, key, step[key] ?? ""));
      controls.set("session", select(parent, "Session policy", ["fresh", "resume"], step.session));
      controls.set(
        "promptMode",
        select(
          parent,
          "Prompt source",
          ["prompt", "prompt_file"],
          step.prompt_file === undefined ? "prompt" : "prompt_file",
        ),
      );
      controls.set(
        "promptValue",
        input(
          parent,
          "Prompt text or prompt file path",
          step.prompt ?? step.prompt_file ?? "",
          true,
        ),
      );
      controls.set(
        "instructions",
        input(
          parent,
          "Stage instruction paths — one per line",
          step.instructions?.join("\n") ?? "",
          true,
        ),
      );
      controls.set(
        "outcomes",
        input(parent, "Declared outcomes — one per line", step.outcomes.join("\n"), true),
      );
      controls.set(
        "reports",
        input(
          parent,
          "Context report step IDs — one per line",
          step.context?.include_reports?.join("\n") ?? "",
          true,
        ),
      );
    } else if (step.kind === "command") {
      controls.set(
        "argv",
        input(
          parent,
          "Argument vector (JSON string array; preserves empty arguments)",
          pretty(step.argv),
          true,
        ),
      );
      controls.set(
        "env",
        input(
          parent,
          "Environment overrides (JSON string map; keep secrets out)",
          pretty(step.env ?? {}),
          true,
        ),
      );
    }
    button(parent, "Apply stage fields", () =>
      this.mutate((m) => {
        const next = structuredClone(step);
        next.tags = lines(tags.value);
        if (next.kind === "agent" || next.kind === "command") {
          next.cwd = controls.get("cwd")?.value || undefined;
          const timeout = controls.get("timeout_seconds")?.value;
          next.timeout_seconds = timeout ? Number(timeout) : undefined;
        }
        if (next.kind === "agent") {
          next.harness = controls.get("harness")?.value ?? "";
          next.model = controls.get("model")?.value || undefined;
          next.reasoning_effort = controls.get("reasoning_effort")?.value || undefined;
          next.session = controls.get("session")?.value as "fresh" | "resume";
          delete next.prompt;
          delete next.prompt_file;
          if (controls.get("promptMode")?.value === "prompt")
            next.prompt = controls.get("promptValue")?.value ?? "";
          else next.prompt_file = controls.get("promptValue")?.value ?? "";
          next.instructions = lines(controls.get("instructions")?.value ?? "");
          next.outcomes = lines(controls.get("outcomes")?.value ?? "");
          next.context = { include_reports: lines(controls.get("reports")?.value ?? "") };
        } else if (next.kind === "command") {
          next.argv = JSON.parse(controls.get("argv")?.value ?? "[]");
          next.env = JSON.parse(controls.get("env")?.value ?? "{}");
        }
        m.steps[id] = next;
      }),
    );
    const outcomes =
      step.kind === "agent"
        ? step.outcomes
        : step.kind === "task.next"
          ? ["task_ready", "exhausted"]
          : step.kind === "command"
            ? ["complete", "failed"]
            : ["complete"];
    parent.append(node("h4", "Direct outcome overrides"));
    this.transitions(parent, step.on ?? {}, outcomes, (on) =>
      this.mutate((m) => {
        const target = m.steps[id];
        if (target && target.kind !== "end") target.on = on;
      }),
    );
    parent.append(node("h4", "Effective inherited transitions"));
    parent.append(
      node(
        "p",
        "Exact outcome: direct step > explicit-step policy > tag policy > all-step policy > defaults. Only then: system.error at the same levels > built-in pause. Policy numbers are 1-based; equal-level conflicts are errors.",
      ),
    );
    const effective = this.draft?.transitions[id];
    if (!effective)
      parent.append(
        node("p", "Resolve compile errors to view effective transitions. No routes guessed."),
      );
    else {
      const table = node("table");
      table.className = "effective";
      const heading = node("tr");
      for (const text of ["Outcome", "Action", "Provenance"]) heading.append(node("th", text));
      table.append(heading);
      for (const rule of effective) {
        const row = node("tr");
        const action = rule.action;
        const text =
          action.kind === "goto"
            ? `goto ${action.target}`
            : action.kind === "retry"
              ? `retry · ${action.maxAttempts} total · ${action.backoffSeconds}s backoff`
              : "pause";
        for (const value of [
          rule.outcome,
          text,
          `${rule.source.level}${"policyIndex" in rule.source ? ` #${rule.source.policyIndex + 1}` : ""}${rule.viaSystemError ? " via system.error" : ""}`,
        ])
          row.append(node("td", value));
        table.append(row);
      }
      const scroll = node("div");
      scroll.className = "table-scroll";
      scroll.append(table);
      parent.append(scroll);
    }
  }
  private policies(model: WorkflowDocument) {
    const defaults = node("details");
    defaults.open = true;
    defaults.append(node("summary", "Workflow defaults and optional limits"));
    const correction = select(
      defaults,
      "Report correction attempts (blank = canonical default)",
      ["", "0", "1"],
      model.defaults?.report_correction_attempts?.toString() ?? "",
    );
    const limits = [
      "max_wall_time_seconds",
      "max_step_executions",
      "agent_idle_timeout_seconds",
    ] as const;
    const controls = limits.map((key) =>
      input(defaults, key, model.limits?.[key]?.toString() ?? ""),
    );
    button(defaults, "Apply defaults / limits", () =>
      this.mutate((m) => {
        m.defaults ??= {};
        if (correction.value)
          m.defaults.report_correction_attempts = Number(correction.value) as 0 | 1;
        else delete m.defaults.report_correction_attempts;
        m.limits = {};
        for (const [index, key] of limits.entries()) {
          const value = controls[index]?.value;
          if (value) m.limits[key] = Number(value);
        }
      }),
    );
    const allOutcomes = Object.values(model.steps).flatMap((s) =>
      s.kind === "agent" ? s.outcomes : [],
    );
    this.transitions(defaults, model.defaults?.on ?? {}, allOutcomes, (on) =>
      this.mutate((m) => {
        m.defaults = { ...m.defaults, on };
      }),
    );
    this.fields.append(defaults);
    const policies = node("div");
    policies.append(node("h3", "Scoped policies"));
    for (const [index, policy] of (model.policies ?? []).entries()) {
      const panel = node("details");
      panel.open = true;
      panel.append(node("summary", `Policy #${index + 1}`));
      const scope = "all" in policy.match ? "all" : "tags" in policy.match ? "tags" : "step_ids";
      const kind = select(panel, "Selector", ["all", "tags", "step_ids"], scope);
      const values = input(
        panel,
        "Tags or explicit step IDs — one per line",
        "tags" in policy.match
          ? policy.match.tags.join("\n")
          : "step_ids" in policy.match
            ? policy.match.step_ids.join("\n")
            : "",
        true,
      );
      button(panel, "Apply selector", () =>
        this.mutate((m) => {
          const target = m.policies?.[index];
          if (target)
            target.match =
              kind.value === "all"
                ? { all: true }
                : kind.value === "tags"
                  ? { tags: lines(values.value) }
                  : { step_ids: lines(values.value) };
        }),
      );
      this.transitions(panel, policy.on, allOutcomes, (on) =>
        this.mutate((m) => {
          const target = m.policies?.[index];
          if (target) target.on = on;
        }),
      );
      button(panel, "Remove policy", () =>
        this.mutate((m) => {
          m.policies?.splice(index, 1);
        }),
      );
      policies.append(panel);
    }
    button(policies, "Add all-step policy (system.error → pause)", () =>
      this.mutate((m) => {
        const policy: PolicyDeclaration = {
          match: { all: true },
          on: { "system.error": { pause: true } },
        };
        m.policies = [...(m.policies ?? []), policy];
      }),
    );
    this.fields.append(policies);
  }
}
