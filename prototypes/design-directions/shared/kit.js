/*
 * PROTOTYPE KIT — shared behaviour for the three design-direction prototypes.
 * Sample data only: no fetch, no daemon, no providers. Validation and YAML output here are
 * illustrative stand-ins for the real compiler/serializer, which remain the authority.
 */
(() => {
  const DATA = window.WFZ_DATA;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const h = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const KIND = {
    agent: {
      label: "Ask an agent",
      short: "Agent",
      hint: "A coding agent works on a prompt and reports a result.",
    },
    command: {
      label: "Run a command",
      short: "Command",
      hint: "Runs a program in the project folder. Exit code 0 means complete.",
    },
    "task.next": {
      label: "Pick the next task",
      short: "Next task",
      hint: "Takes the next unchecked item from the task checklist.",
    },
    "task.complete": {
      label: "Mark task done",
      short: "Task done",
      hint: "Records the current task as finished in Workflowz (the checklist file is not edited).",
    },
    end: { label: "Finish", short: "Finish", hint: "Ends the run successfully." },
  };

  const OUTCOME_HELP = {
    complete: "finished successfully",
    failed: "exited with a non-zero code",
    task_ready: "a task was picked",
    exhausted: "no tasks are left",
  };

  const SYSTEM_LABELS = {
    "system.error": "Any technical failure",
    "system.timeout": "Timed out",
    "system.spawn_error": "Could not start",
    "system.process_error": "Process failed",
    "system.report_error": "No valid report",
    "system.resume_unavailable": "Previous session unavailable",
    "system.retry_exhausted": "Retries used up",
  };

  function humanize(id) {
    if (!id) return "";
    const text = id.replaceAll("_", " ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  function slug(name) {
    let id = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64);
    if (!/^[a-z]/.test(id)) id = `step_${id}`;
    return id;
  }

  function outcomesOf(step) {
    if (step.kind === "agent") return step.outcomes;
    if (step.kind === "command") return ["complete", "failed"];
    if (step.kind === "task.next") return ["task_ready", "exhausted"];
    if (step.kind === "task.complete") return ["complete"];
    return [];
  }
  function stepById(draft, id) {
    return draft.steps.find((step) => step.id === id);
  }
  function stepName(draft, id) {
    const step = stepById(draft, id);
    if (step?.kind === "end") return step.label ? `Finish — ${step.label}` : "Finish";
    return humanize(id);
  }

  /** Mirrors routing precedence: step > step_ids policy > tag policy > all policy > defaults. */
  function effectiveRule(draft, step, outcome) {
    const own = step.on?.[outcome];
    if (own) return { action: own, source: "step" };
    const levels = [
      ["step_ids", (p) => p.match.step_ids?.includes(step.id), "Shared rule for"],
      ["tags", (p) => p.match.tags?.some((tag) => step.tags?.includes(tag)), "Shared rule for tag"],
      ["all", (p) => p.match.all === true, "Shared rule for all steps"],
    ];
    for (const [level, covers] of levels) {
      const index = draft.policies.findIndex((p) => p.match[level] && covers(p) && p.on[outcome]);
      if (index >= 0) {
        const policy = draft.policies[index];
        const label =
          level === "tags"
            ? `Shared rule · tag “${policy.match.tags.join(", ")}”`
            : level === "all"
              ? "Shared rule · all steps"
              : `Shared rule · ${policy.match.step_ids.map(humanize).join(", ")}`;
        return { action: policy.on[outcome], source: "policy", policyIndex: index, label };
      }
    }
    if (draft.defaults.on?.[outcome]) {
      return { action: draft.defaults.on[outcome], source: "default", label: "Workflow default" };
    }
    if (outcome.startsWith("system.") && outcome !== "system.error") {
      const fallback = effectiveRule(draft, step, "system.error");
      if (fallback)
        return { ...fallback, label: `${fallback.label ?? "Step rule"} (any technical failure)` };
      return { action: { pause: true }, source: "builtin", label: "Built-in: pause" };
    }
    return null;
  }

  function actionKey(action) {
    if (!action) return "";
    if (action.goto) return `goto:${action.goto}`;
    if (action.pause) return "pause";
    if (action.retry) return "retry";
    return "";
  }
  function describeAction(draft, action) {
    if (!action) return "Not chosen yet";
    if (action.goto) {
      const target = stepById(draft, action.goto);
      if (!target) return `Go to “${action.goto}” (missing step)`;
      return target.kind === "end"
        ? stepName(draft, action.goto)
        : `Go to ${humanize(action.goto)}`;
    }
    if (action.pause) return "Pause and wait for me";
    if (action.retry) {
      const { max_attempts: n, backoff_seconds: wait } = action.retry;
      return `Retry this step (up to ${n} runs${wait ? `, ${wait}s apart` : ""})`;
    }
    return "Unknown";
  }

  function validate(draft) {
    const issues = [];
    const ids = new Set(draft.steps.map((s) => s.id));
    if (!draft.name.trim())
      issues.push({ severity: "error", field: "name", text: "Give the workflow a name." });
    if (!draft.project.root.trim())
      issues.push({
        severity: "error",
        field: "project",
        text: "Choose the project folder the steps work in.",
      });
    if (!ids.has(draft.start))
      issues.push({ severity: "error", field: "start", text: "Choose which step runs first." });
    for (const step of draft.steps) {
      const name = humanize(step.id);
      if (step.kind === "agent" && !step.prompt.trim())
        issues.push({
          severity: "error",
          stepId: step.id,
          field: "prompt",
          text: `${name} needs a prompt.`,
        });
      if (step.kind === "agent" && step.outcomes.length === 0)
        issues.push({
          severity: "error",
          stepId: step.id,
          field: "outcomes",
          text: `${name} needs at least one result the agent can report.`,
        });
      if (step.kind === "command" && !step.argv[0])
        issues.push({
          severity: "error",
          stepId: step.id,
          field: "argv",
          text: `${name} needs a command to run.`,
        });
      for (const outcome of outcomesOf(step)) {
        const rule = effectiveRule(draft, step, outcome);
        if (!rule)
          issues.push({
            severity: "error",
            stepId: step.id,
            outcome,
            text: `${name}: choose what happens when the result is “${outcome}”.`,
          });
        else if (rule.action.goto && !ids.has(rule.action.goto))
          issues.push({
            severity: "error",
            stepId: step.id,
            outcome,
            text: `${name}: “${outcome}” goes to a step that no longer exists.`,
          });
      }
      if (step.kind === "task.next" && !draft.project.tasksPath)
        issues.push({
          severity: "error",
          stepId: step.id,
          text: `${name} needs a task checklist (Project settings).`,
        });
    }
    const reachable = new Set();
    const queue = [draft.start];
    while (queue.length) {
      const id = queue.shift();
      const step = stepById(draft, id);
      if (!step || reachable.has(id)) continue;
      reachable.add(id);
      for (const outcome of [...outcomesOf(step), "system.error"]) {
        const target = effectiveRule(draft, step, outcome)?.action.goto;
        if (target) queue.push(target);
      }
    }
    for (const step of draft.steps)
      if (!reachable.has(step.id) && ids.has(draft.start))
        issues.push({
          severity: "warning",
          stepId: step.id,
          text: `${humanize(step.id)} is never reached from the first step.`,
        });
    return issues;
  }

  /* ---------- YAML (illustrative serializer for the prototype's read-only YAML view) ---------- */
  function scalar(value) {
    if (value === null || value === undefined) return "null";
    if (typeof value !== "string") return String(value);
    if (
      value === "" ||
      /^[\s]|[\s]$|[:#{}[\],&*?|>'"%@`]|^(true|false|null|yes|no|~|-?\d)/i.test(value)
    )
      return JSON.stringify(value);
    return value;
  }
  function inline(action) {
    if (action.goto) return `{ goto: ${action.goto} }`;
    if (action.pause) return "{ pause: true }";
    const r = action.retry;
    return `{ retry: { max_attempts: ${r.max_attempts}${r.backoff_seconds ? `, backoff_seconds: ${r.backoff_seconds}` : ""} } }`;
  }
  function onBlock(on, pad) {
    const keys = Object.keys(on ?? {});
    if (!keys.length) return [];
    return [`${pad}on:`, ...keys.map((k) => `${pad}  ${k}: ${inline(on[k])}`)];
  }
  function toYaml(draft) {
    const out = [
      "version: 1",
      `name: ${scalar(draft.name)}`,
      "project:",
      `  root: ${scalar(draft.project.root)}`,
    ];
    if (draft.project.instructions.length)
      out.push("  instructions:", ...draft.project.instructions.map((p) => `    - ${scalar(p)}`));
    if (draft.project.tasksPath)
      out.push(
        "tasks:",
        "  source:",
        "    kind: markdown_checklist",
        `    path: ${scalar(draft.project.tasksPath)}`,
      );
    out.push(`start: ${draft.start}`);
    const limits = Object.entries(draft.limits).filter(([, v]) => v);
    if (limits.length) out.push("limits:", ...limits.map(([k, v]) => `  ${k}: ${v}`));
    out.push(
      "defaults:",
      `  report_correction_attempts: ${draft.defaults.report_correction_attempts}`,
    );
    out.push(...onBlock(draft.defaults.on, "  "));
    if (draft.policies.length) {
      out.push("policies:");
      for (const p of draft.policies) {
        const [key, value] = Object.entries(p.match)[0];
        out.push(
          "  - match:",
          `      ${key}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`,
        );
        out.push(...onBlock(p.on, "    "));
      }
    }
    out.push("steps:");
    for (const s of draft.steps) {
      out.push(`  ${s.id}:`, `    kind: ${s.kind}`);
      if (s.kind === "agent") {
        out.push(`    harness: ${s.harness}`);
        if (s.model) out.push(`    model: ${scalar(s.model)}`);
        if (s.reasoning_effort) out.push(`    reasoning_effort: ${s.reasoning_effort}`);
        out.push(`    session: ${s.session}`);
        if (s.tags.length) out.push(`    tags: [${s.tags.join(", ")}]`);
        if (s.include_reports.length)
          out.push("    context:", `      include_reports: [${s.include_reports.join(", ")}]`);
        if (s.timeout_seconds) out.push(`    timeout_seconds: ${s.timeout_seconds}`);
        out.push(
          "    prompt: |",
          ...s.prompt.split("\n").map((line) => (line ? `      ${line}` : "")),
        );
        out.push(`    outcomes: [${s.outcomes.join(", ")}]`);
      }
      if (s.kind === "command") {
        if (s.cwd) out.push(`    cwd: ${scalar(s.cwd)}`);
        out.push(`    argv: [${s.argv.map((a) => JSON.stringify(a)).join(", ")}]`);
      }
      if (s.kind === "end" && s.label) out.push(`    label: ${scalar(s.label)}`);
      out.push(...onBlock(s.on, "    "));
    }
    return `${out.join("\n")}\n`;
  }

  /* ---------- run view model ---------- */
  const STATUS = {
    ready: { label: "Ready", tone: "neutral" },
    running: { label: "Running", tone: "active" },
    pausing: { label: "Pausing", tone: "active" },
    paused: { label: "Paused", tone: "attention" },
    completed: { label: "Completed", tone: "success" },
    interrupted: { label: "Interrupted", tone: "danger" },
    stopped: { label: "Stopped", tone: "neutral" },
  };

  function rawEvents(item, index) {
    if (!item.outcome && !item.running && !item.interrupted) return [];
    const step = stepById(DATA.draft, item.step);
    const base = 380 + index * 6;
    const attempt = `att_${(0x3a10 + index * 7).toString(16)}`;
    const events = [];
    const at = `2026-10-20T${item.at}Z`;
    if (step.kind === "agent" || step.kind === "command") {
      events.push({
        id: base,
        type: "attempt_started",
        at,
        data: { attemptId: attempt, stepId: item.step, taskId: item.task ? `t${item.task}` : null },
      });
      events.push({
        id: base + 1,
        type: "attempt_prepared",
        at,
        data: { attemptId: attempt, inputBytes: step.kind === "agent" ? 6214 : 0 },
      });
      const harness = DATA.harnesses.find((x) => x.id === step.harness);
      events.push({
        id: base + 2,
        type: "invocation_started",
        at,
        data:
          step.kind === "agent"
            ? {
                attemptId: attempt,
                harness: step.harness,
                model: step.model || null,
                permissionMode: harness?.permission ?? null,
                pid: 48211 + index,
                pgid: 48211 + index,
                cliVersion: step.harness === "opencode" ? "2.0.32" : "1.4.2",
              }
            : {
                attemptId: attempt,
                argv: step.argv.map((a) =>
                  a.replace("{{task.id}}", `t${item.task}`).replace("{{task.text}}", "…"),
                ),
                pid: 48211 + index,
                pgid: 48211 + index,
              },
      });
      if (item.running) return events;
      if (item.interrupted) {
        events.push({
          id: base + 3,
          type: "run_interrupted",
          at,
          data: { reason: "daemon_restart", attemptId: attempt },
        });
        events.push({
          id: base + 4,
          type: "process_reconciled",
          at,
          data: { attemptId: attempt, observation: "absent" },
        });
        events.push({
          id: base + 5,
          type: "attention_raised",
          at,
          data: { severity: "blocking", code: "recovery_required" },
        });
        return events;
      }
      events.push({
        id: base + 3,
        type: "invocation_settled",
        at,
        data: {
          attemptId: attempt,
          exitCode: 0,
          signal: null,
          stderrTail: "",
          captureTruncated: false,
        },
      });
      if (step.kind === "agent")
        events.push({
          id: base + 4,
          type: "report_accepted",
          at,
          data: { attemptId: attempt, outcome: item.outcome, summary: item.summary },
        });
    }
    events.push({
      id: base + 5,
      type: "transition_committed",
      at,
      data: {
        from: item.step,
        outcome: item.outcome,
        to: item.to ?? null,
        action: item.pause ? "pause" : "goto",
        source: item.ruleSource ? "tag_policy" : "step",
      },
    });
    return events;
  }

  function runView(state) {
    const run = state.run;
    const v = run.variant;
    const items = DATA.history
      .filter(
        (item) =>
          !item.variants ||
          item.variants.includes(v === "pausing" ? "running" : v === "stopped" ? "interrupted" : v),
      )
      .filter((_item) => v !== "ready")
      .map((item, index) => {
        if (v === "stopped" && item.interrupted)
          return { ...item, interrupted: false, stopped: true, events: rawEvents(item, index) };
        return { ...item, events: rawEvents(item, index) };
      })
      .concat(run.manual);
    const last = items.at(-1);
    const currentTask = v === "completed" ? null : v === "ready" ? null : DATA.tasks[2];
    const tasksDone = v === "completed" ? 5 : v === "ready" ? 0 : run.markedComplete ? 3 : 2;
    const cursor =
      run.cursor ?? (v === "ready" ? "pick_task" : v === "completed" ? "done" : "review");
    const copy = {
      ready: {
        headline: "Ready to start",
        detail:
          "Nothing has run yet. Start runs “Pick task” first and works through 5 imported tasks. Closing the browser later will not stop it.",
      },
      running: {
        headline: "Running — Review, task 3 of 5",
        detail:
          "OpenCode (deepseek-v4.1-flash-free) is reviewing the CSV export. The run continues if you close this browser.",
      },
      pausing: {
        headline: "Pausing after Review finishes",
        detail:
          "The current step keeps running. When it reports, the result is recorded and the run pauses instead of moving on.",
      },
      paused: run.manual.length
        ? {
            headline: `Paused — next step is ${humanize(cursor)}`,
            detail:
              "Your change is recorded. Resume when you're ready; the run will continue from the step shown.",
          }
        : {
            headline: "Paused — Review needs your decision",
            detail:
              "The reviewer reported blocked: number formatting in the CSV isn't specified. Choose what happens next.",
          },
      completed: {
        headline: "Completed — all imported tasks done",
        detail:
          "5 tasks finished in 38m 19s. 5 commits were created by the workflow's Git commands.",
      },
      interrupted: {
        headline: "Interrupted — Review may not have finished",
        detail:
          "The daemon restarted while Review was running. Workflowz never reruns uncertain work on its own. The process is confirmed gone; choose a recovery decision.",
      },
      stopped: {
        headline: "Stopped",
        detail: `Stopped by you: “${run.stopReason || "Wrong formatting decision; will rerun"}”. Files changed by agents were not rolled back.`,
      },
    }[v];
    return {
      status: v,
      ...STATUS[v],
      ...copy,
      items,
      last,
      currentTask,
      tasksDone,
      cursor,
      runId: "run_8c1e2f40",
      eventId: 412 + run.manual.length * 2 + (state.sim.stale ? 3 : 0),
      elapsed: {
        ready: "—",
        running: "29m 55s",
        pausing: "30m 02s",
        paused: "31m 47s",
        completed: "38m 19s",
        interrupted: "29m 23s",
        stopped: "29m 30s",
      }[v],
    };
  }

  /* ---------- state & actions ---------- */
  const initialRun = () => ({
    variant: "paused",
    selected: "h18",
    raw: false,
    manual: [],
    cursor: null,
    markedComplete: false,
    stopReason: "",
  });
  const state = {
    route: { view: "workflows" },
    draft: clone(DATA.draft),
    saved: "",
    savedRevision: 12,
    editorMode: "workflow",
    selectedStep: "implement",
    runs: clone(DATA.runs),
    run: initialRun(),
    fb: {},
    busy: {},
    sim: { stale: false, disconnected: false },
    ui: {},
  };

  const TEMPLATES = {
    single: (name, root) => ({
      ...base(name, root, "work"),
      steps: [
        {
          id: "work",
          kind: "agent",
          harness: "codex",
          model: "",
          reasoning_effort: "",
          session: "fresh",
          tags: [],
          include_reports: [],
          prompt: "",
          outcomes: ["complete", "blocked"],
          on: { complete: { goto: "done" }, blocked: { pause: true } },
          timeout_seconds: null,
        },
        { id: "done", kind: "end", label: "" },
      ],
    }),
    loop: (name, root) => ({
      ...base(name, root, "pick_task"),
      project: { root, instructions: [], tasksPath: "todo.md", includeCompleted: false },
      limits: {
        max_step_executions: 60,
        max_wall_time_seconds: null,
        agent_idle_timeout_seconds: null,
      },
      steps: [
        {
          id: "pick_task",
          kind: "task.next",
          on: { task_ready: { goto: "implement" }, exhausted: { goto: "done" } },
        },
        {
          id: "implement",
          kind: "agent",
          harness: "codex",
          model: "",
          reasoning_effort: "",
          session: "fresh",
          tags: [],
          include_reports: [],
          prompt:
            "Implement this task:\n{{task.text}}\nReport complete or blocked with a short summary.",
          outcomes: ["complete", "blocked"],
          on: { complete: { goto: "mark_done" }, blocked: { pause: true } },
          timeout_seconds: null,
        },
        { id: "mark_done", kind: "task.complete", on: { complete: { goto: "pick_task" } } },
        { id: "done", kind: "end", label: "All tasks done" },
      ],
    }),
    commands: (name, root) => ({
      ...base(name, root, "run_tests"),
      steps: [
        {
          id: "run_tests",
          kind: "command",
          argv: ["npm", "test"],
          cwd: "",
          env: {},
          on: { complete: { goto: "done" }, failed: { pause: true } },
        },
        { id: "done", kind: "end", label: "" },
      ],
    }),
  };
  function base(name, root, start) {
    return {
      name,
      basedOnRevision: null,
      workflowDir: `${root}/workflows`,
      project: { root, instructions: [], tasksPath: "", includeCompleted: false },
      start,
      limits: {
        max_step_executions: null,
        max_wall_time_seconds: null,
        agent_idle_timeout_seconds: null,
      },
      defaults: { report_correction_attempts: 1, on: { "system.error": { pause: true } } },
      policies: [],
      steps: [],
    };
  }
  /** DATA.draft is saved revision 12; the working copy carries the owner's unsaved edit. */
  function loadSample() {
    state.saved = JSON.stringify(DATA.draft);
    state.draft = clone(DATA.draft);
    const debug = state.draft.steps.find((s) => s.id === "debug");
    debug.outcomes.splice(1, 0, "unable_to_fix");
    debug.prompt = debug.prompt.replace(
      "repaired or blocked",
      "repaired, unable_to_fix or blocked",
    );
    state.savedRevision = 12;
    state.selectedStep = "debug";
    state.draftId = "implement-review-commit";
  }

  const listeners = [];
  let app = null;

  function dirty() {
    return JSON.stringify(state.draft) !== state.saved;
  }
  function feedback(key, kind, text) {
    state.fb[key] = { kind, text, at: Date.now() };
  }
  async function busy(key, ms, pendingText) {
    state.busy[key] = true;
    feedback(key, "pending", pendingText);
    update();
    await wait(ms);
    state.busy[key] = false;
  }

  function parseHash() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (parts[0] === "runs" && parts[1] && parts[2] === "edit")
      return { view: "editor", runEdit: parts[1] };
    if (parts[0] === "runs" && parts[1]) return { view: "run", id: parts[1] };
    if (parts[0] === "runs") return { view: "runs" };
    if (parts[0] === "workflows" && parts[1] === "new") return { view: "new" };
    if (parts[0] === "workflows" && parts[1]) return { view: "editor", id: parts[1] };
    return { view: "workflows" };
  }
  function nav(path) {
    if (location.hash === `#/${path}`) return;
    location.hash = `#/${path}`;
  }

  function requireFresh(key) {
    if (state.sim.disconnected) {
      feedback(
        key,
        "error",
        "Not sent — the browser is disconnected from the daemon. Nothing changed.",
      );
      return false;
    }
    if (state.sim.stale) {
      state.sim.stale = false;
      feedback(
        key,
        "error",
        "Not applied — this run changed elsewhere (CLI or another tab). The page now shows the latest state; check it and try again. Nothing was changed.",
      );
      return false;
    }
    return true;
  }

  const actions = {
    nav: ({ to }) => nav(to),
    selectStep: ({ step }) => {
      state.selectedStep = step;
    },
    setRule: ({ step, outcome }, el) => {
      const s = stepById(state.draft, step);
      const value = el.value;
      s.on = s.on ?? {};
      if (value === "inherit" || value === "") delete s.on[outcome];
      else if (value === "pause") s.on[outcome] = { pause: true };
      else if (value === "retry")
        s.on[outcome] = { retry: { max_attempts: 2, backoff_seconds: 0 } };
      else if (value.startsWith("goto:")) s.on[outcome] = { goto: value.slice(5) };
      else if (value === "new") {
        state.ui.newStepFor = { step, outcome };
        state.ui.focusSel = '[data-focus="newstep-name"]';
        return;
      }
    },
    addOutcome: ({ step }) => {
      const s = stepById(state.draft, step);
      const input = document.querySelector(`[data-new-outcome="${step}"]`);
      const name = slug(input?.value ?? "").replace(/^step_/, "");
      if (!name || !input?.value.trim()) {
        feedback(`outcome:${step}`, "error", "Type a result name first, e.g. needs_info.");
        return;
      }
      if (s.outcomes.includes(name)) {
        feedback(`outcome:${step}`, "error", `“${name}” is already a result of this step.`);
        return;
      }
      s.outcomes.push(name);
      feedback(`outcome:${step}`, "ok", `Added “${name}”. Now choose what happens next.`);
      state.ui.focusSel = `[data-rule-key="${step}|${name}"]`;
    },
    removeOutcome: ({ step, outcome }) => {
      const s = stepById(state.draft, step);
      s.outcomes = s.outcomes.filter((o) => o !== outcome);
      delete s.on[outcome];
    },
    addStep: ({ kind, after, name }) => {
      const rawName = name ?? document.querySelector("[data-new-step-name]")?.value ?? "";
      const label =
        rawName.trim() ||
        { agent: "New agent step", command: "New command" }[kind] ||
        KIND[kind].label;
      let id = slug(label);
      while (stepById(state.draft, id)) id = `${id}_2`;
      const step =
        kind === "agent"
          ? {
              id,
              kind,
              harness: "codex",
              model: "",
              reasoning_effort: "",
              session: "fresh",
              tags: [],
              include_reports: [],
              prompt: "",
              outcomes: ["complete", "blocked"],
              on: { blocked: { pause: true } },
              timeout_seconds: null,
            }
          : kind === "command"
            ? { id, kind, argv: [""], cwd: "", env: {}, on: { failed: { pause: true } } }
            : kind === "end"
              ? { id, kind, label: "" }
              : { id, kind, on: {} };
      const at = state.draft.steps.findIndex((s) => s.id === (after || state.selectedStep));
      state.draft.steps.splice(at + 1, 0, step);
      if (state.ui.newStepFor) {
        const { step: from, outcome } = state.ui.newStepFor;
        stepById(state.draft, from).on[outcome] = { goto: id };
        state.ui.newStepFor = null;
      }
      state.selectedStep = id;
      state.ui.adding = false;
      state.ui.focusSel = `[data-step-title="${id}"]`;
      feedback("step", "ok", `Added “${humanize(id)}”. Fill in its details below.`);
    },
    deleteStep: ({ step }) => {
      const refs = state.draft.steps.filter((s) =>
        Object.values(s.on ?? {}).some((a) => a?.goto === step),
      );
      state.draft.steps = state.draft.steps.filter((s) => s.id !== step);
      for (const s of refs)
        for (const [k, a] of Object.entries(s.on)) if (a?.goto === step) delete s.on[k];
      state.selectedStep = state.draft.steps[0]?.id;
      feedback(
        "step",
        "ok",
        `Removed “${humanize(step)}”.${refs.length ? ` ${refs.length} connection(s) now need a new destination.` : ""}`,
      );
    },
    moveStep: ({ step, dir }) => {
      const i = state.draft.steps.findIndex((s) => s.id === step);
      const j = i + Number(dir);
      if (j < 0 || j >= state.draft.steps.length) return;
      const [s] = state.draft.steps.splice(i, 1);
      state.draft.steps.splice(j, 0, s);
    },
    validate: async () => {
      await busy("validate", 450, "Checking…");
      const issues = validate(state.draft);
      const errors = issues.filter((i) => i.severity === "error").length;
      feedback(
        "validate",
        errors ? "error" : "ok",
        errors
          ? `${errors} problem${errors > 1 ? "s" : ""} to fix before saving.`
          : "No problems found. Ready to save.",
      );
    },
    save: async () => {
      if (state.editorMode === "run") return actions.applyRevision();
      await busy("save", 650, "Saving…");
      if (state.sim.disconnected)
        return feedback(
          "save",
          "error",
          "Not saved — disconnected from the daemon. Your edits are still here.",
        );
      const errors = validate(state.draft).filter((i) => i.severity === "error");
      if (errors.length) return feedback("save", "error", `Not saved — ${errors[0].text}`);
      state.savedRevision += 1;
      state.saved = JSON.stringify(state.draft);
      feedback("save", "ok", `Saved as revision ${state.savedRevision}.`);
    },
    createRun: async () => {
      if (dirty())
        return feedback(
          "create",
          "error",
          "Save your changes first — a run uses a saved revision.",
        );
      const tasksPath = state.draft.project.tasksPath;
      await busy("create", 800, tasksPath ? `Importing tasks from ${tasksPath}…` : "Creating run…");
      if (state.sim.disconnected)
        return feedback("create", "error", "Run not created — disconnected from the daemon.");
      state.runs.unshift({
        id: "run_4d2b9e07",
        workflow: state.draft.name,
        revision: state.savedRevision,
        project: "tiny-ledger",
        status: "ready",
        note: "Not started",
        progress: tasksPath ? [0, 5] : null,
        step: state.draft.start,
        updated: "Just now",
        created: "Just now",
      });
      state.run = { ...initialRun(), variant: "ready", selected: null };
      feedback(
        "run",
        "ok",
        `Run created${tasksPath ? ` with 5 tasks from ${tasksPath}` : ""}. It has not started — press Start when ready.`,
      );
      state.ui.highlightRun = "run_4d2b9e07";
      nav("runs/run_4d2b9e07");
    },
    newDraft: () => {
      const name = (state.ui.newName ?? "").trim();
      const root = (state.ui.newRoot ?? "").trim();
      if (!name || !root.startsWith("/")) {
        feedback(
          "new",
          "error",
          !name
            ? "Give the workflow a name."
            : "Project folder must be an absolute path, e.g. /home/you/code/app.",
        );
        return;
      }
      state.newDraft = TEMPLATES[state.ui.newTemplate ?? "single"](name, root);
      state.draftId = null;
      state.fb = {};
      feedback("save", "ok", "Draft created. It isn't saved until you press Save.");
      nav("workflows/draft-new");
    },
    discard: () => {
      state.draft = JSON.parse(state.saved);
      feedback("save", "ok", "Changes discarded.");
    },
    applyRevision: async () => {
      const reason = state.ui.revisionReason?.trim();
      if (!reason)
        return feedback(
          "save",
          "error",
          "Add a short reason — it's recorded in the run's history.",
        );
      const problems = validate(state.draft).filter((i) => i.severity === "error");
      if (problems.length) return feedback("save", "error", `Not applied — ${problems[0].text}`);
      await busy("save", 650, "Applying to this run…");
      if (!requireFresh("save")) return;
      state.saved = JSON.stringify(state.draft);
      state.run.manual.push({
        id: `m${Date.now()}`,
        task: 3,
        manual: true,
        step: state.run.cursor ?? "review",
        at: "21:41:02",
        dur: "",
        note: `Workflow revised for this run: “${reason}”`,
        events: [
          { id: 420, type: "workflow_revised", at: "2026-10-20T21:41:02Z", data: { reason } },
        ],
      });
      feedback(
        "run",
        "ok",
        "Revision applied to future steps of this run. Still paused — Resume when ready.",
      );
      nav(`runs/${state.route.runEdit}`);
    },
    selectItem: ({ item }) => {
      state.run.selected = item;
    },
    toggleRaw: () => {
      state.run.raw = !state.run.raw;
    },
    runControl: async ({ op }) => {
      const reasonNeeded = ["stop", "resume", "jump", "skip", "complete-task"].includes(op);
      const reason = (state.ui[`reason:${op}`] ?? "").trim();
      if (reasonNeeded && !reason) {
        feedback(op, "error", "Add a reason — it is saved in the run's audit history.");
        return;
      }
      const pending = {
        start: "Starting…",
        pause: "Requesting pause…",
        stop: "Stopping and waiting for the process to exit…",
        resume: "Resuming…",
        jump: "Applying…",
        skip: "Applying…",
        "complete-task": "Applying…",
      }[op];
      await busy(op, op === "stop" ? 1400 : 700, pending);
      if (!requireFresh(op)) return update();
      const r = state.run;
      if (op === "start") {
        r.variant = "running";
        r.selected = "h18r";
        feedback("run", "ok", "Started. Pick task → Implement are running now.");
        const row = state.runs.find((x) => x.id === state.route.id);
        if (row) Object.assign(row, { status: "running", note: "Running", updated: "Just now" });
      } else if (op === "pause") {
        r.variant = "pausing";
        feedback("run", "ok", "Pause requested. Review will finish first; nothing is cut off.");
      } else if (op === "stop") {
        r.variant = "stopped";
        r.stopReason = reason;
        feedback("run", "ok", "Stopped. The Review process exited and was cleaned up.");
      } else if (op === "resume") {
        r.variant = "running";
        r.manual = [];
        r.selected = "h18r";
        feedback(
          "run",
          "ok",
          `Resumed. ${humanize(r.cursor ?? "review")} is running again from the beginning.`,
        );
      } else {
        const target = state.ui.interveneTarget;
        if (!target && op !== "complete-task")
          return feedback(op, "error", "Choose a target first.");
        const note =
          op === "jump"
            ? `You moved the run to ${humanize(target)}`
            : op === "skip"
              ? `You skipped Review as “${target}”`
              : "You marked task 3 complete";
        if (op === "jump") r.cursor = target;
        if (op === "skip")
          r.cursor =
            effectiveRule(state.draft, stepById(state.draft, "review"), target)?.action.goto ??
            "review";
        if (op === "complete-task") {
          r.markedComplete = true;
          r.cursor = "pick_task";
        }
        r.manual.push({
          id: `m${r.manual.length}`,
          task: 3,
          manual: true,
          step: "review",
          at: "21:40:18",
          dur: "",
          note: `${note} — “${reason}”`,
          events: [
            {
              id: 414 + r.manual.length * 2,
              type: "manual_override",
              at: "2026-10-20T21:40:18Z",
              data: { action: op, target: target ?? null, reason },
            },
          ],
        });
        r.selected = r.manual.at(-1).id;
        state.ui.intervene = null;
        state.ui.choice = null;
        state.ui.interveneTarget = null;
        feedback("run", "ok", `${note}. Still paused — nothing runs until you press Resume.`);
      }
      for (const key of ["start", "pause", "stop", "resume", "jump", "skip", "complete-task"])
        delete state.fb[key];
      state.ui[`reason:${op}`] = "";
      state.ui.confirm = null;
      state.ui.pop = null;
    },
    setVariant: ({ variant }) => {
      state.run = {
        ...initialRun(),
        variant,
        selected: {
          running: "h18r",
          pausing: "h18r",
          paused: "h18",
          completed: "h34",
          interrupted: "h18i",
          stopped: "h18i",
          ready: null,
        }[variant],
      };
      state.fb = {};
    },
    sim: ({ key }) => {
      state.sim[key] = !state.sim[key];
    },
    ui: ({ key, value }) => {
      state.ui[key] = value === "toggle" ? !state.ui[key] : value === "null" ? null : value;
    },
  };

  function bind(path, value, el) {
    const [scope, ...rest] = path.split(".");
    if (scope === "ui") {
      state.ui[rest.join(".")] = value;
      return false;
    }
    if (scope === "draft") {
      let target = state.draft;
      for (const key of rest.slice(0, -1)) target = target[key];
      const key = rest.at(-1);
      if (key === "instructionsText")
        state.draft.project.instructions = value
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
      else target[key] = el?.type === "number" ? (value === "" ? null : Number(value)) : value;
      return true;
    }
    if (scope === "step") {
      const [id, key, extra] = rest;
      const step = stepById(state.draft, id);
      if (key === "argvText") step.argv = value.split("\n");
      else if (key === "tagsText")
        step.tags = value
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
      else if (key === "reports") {
        step.include_reports = el.checked
          ? [...step.include_reports, extra]
          : step.include_reports.filter((r) => r !== extra);
      } else if (key === "retry") {
        const [outcome, field] = extra.split(":");
        step.on[outcome].retry[field] = Number(value) || 0;
      } else if (key === "model" && value === "(harness default)") step.model = "";
      else step[key] = el?.type === "number" ? (value === "" ? null : Number(value)) : value;
      return true;
    }
    return false;
  }

  /* ---------- rendering with focus/selection/scroll preservation ---------- */
  function focusKey(el) {
    if (!el || el === document.body) return null;
    if (el.dataset.bind) return `[data-bind="${el.dataset.bind}"]`;
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.dataset.focus) return `[data-focus="${el.dataset.focus}"]`;
    if (el.dataset.act)
      return Object.entries(el.dataset)
        .map(
          ([k, v]) =>
            `[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${CSS.escape(v)}"]`,
        )
        .join("");
    return null;
  }
  function update() {
    if (!app) return;
    const root = document.getElementById("app");
    const active = document.activeElement;
    const key = focusKey(active);
    const sel =
      active && "selectionStart" in active ? [active.selectionStart, active.selectionEnd] : null;
    const scrolls = [...root.querySelectorAll("[data-scroll]")].map((el) => [
      el.dataset.scroll,
      el.scrollTop,
    ]);
    const windowScroll = window.scrollY;
    const detailsOpen = [...root.querySelectorAll("details")].map((d) => [detailsKey(d), d.open]);
    root.innerHTML = app.render(state, api) + protoPanel();
    for (const [name, top] of scrolls) {
      const el = root.querySelector(`[data-scroll="${name}"]`);
      if (el) el.scrollTop = top;
    }
    window.scrollTo(0, windowScroll);
    for (const [k, open] of detailsOpen) {
      const el = [...root.querySelectorAll("details")].find((d) => detailsKey(d) === k);
      if (el && !el.querySelector("summary[data-act]")) el.open = open;
    }
    const next =
      (state.ui.focusSel && root.querySelector(state.ui.focusSel)) ||
      (key && root.querySelector(key));
    state.ui.focusSel = null;
    if (next) {
      next.focus({ preventScroll: true });
      if (sel && "setSelectionRange" in next && next === root.querySelector(key)) {
        try {
          next.setSelectionRange(sel[0], sel[1]);
        } catch {
          /* non-text inputs */
        }
      }
    }
    for (const fn of listeners) fn(state);
  }

  function detailsKey(d) {
    return d.dataset.k ?? d.querySelector("summary")?.textContent.trim().slice(0, 32);
  }
  function protoPanel() {
    const variants = [
      "ready",
      "running",
      "pausing",
      "paused",
      "interrupted",
      "stopped",
      "completed",
    ];
    const open = state.ui.protoOpen;
    return `<aside class="proto-panel ${open ? "open" : ""}" aria-label="Prototype controls">
      <button type="button" class="proto-toggle" data-act="ui" data-key="protoOpen" data-value="toggle" aria-expanded="${!!open}">Prototype controls</button>
      ${
        open
          ? `<div class="proto-body">
        <p>Sample data only. Nothing is sent to the daemon.</p>
        <label>Run state shown in Run details
          <select data-proto-variant>${variants.map((v) => `<option ${state.run.variant === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label class="row"><input type="checkbox" data-act="sim" data-key="stale" ${state.sim.stale ? "checked" : ""}/> Simulate “run changed elsewhere”</label>
        <label class="row"><input type="checkbox" data-act="sim" data-key="disconnected" ${state.sim.disconnected ? "checked" : ""}/> Simulate disconnected daemon</label>
        <p><a href="../index.html">← Compare all directions</a></p>
      </div>`
          : ""
      }
    </aside>`;
  }

  function mount(definition) {
    app = definition;
    const root = document.getElementById("app");
    root.addEventListener("click", async (event) => {
      const el = event.target.closest("[data-act]");
      if (!el || el.tagName === "SELECT") return;
      if (el.tagName === "A") event.preventDefault();
      const fn = actions[el.dataset.act] ?? app.actions?.[el.dataset.act];
      if (!fn) return;
      const result = fn(el.dataset, el, state);
      if (el.dataset.focusNext) state.ui.focusSel = el.dataset.focusNext;
      update();
      if (result instanceof Promise) {
        await result;
        update();
      }
    });
    root.addEventListener("input", (event) => {
      const el = event.target;
      if (el.dataset.bind && el.tagName !== "SELECT" && el.type !== "checkbox") {
        bind(el.dataset.bind, el.value, el);
        update();
      }
    });
    root.addEventListener("change", (event) => {
      const el = event.target;
      if (el.dataset.protoVariant !== undefined) actions.setVariant({ variant: el.value });
      else if (el.dataset.rule) {
        const [step, outcome] = el.dataset.rule.split("|");
        actions.setRule({ step, outcome }, el);
      } else if (el.dataset.bind && (el.tagName === "SELECT" || el.type === "checkbox"))
        bind(el.dataset.bind, el.type === "checkbox" ? el.checked : el.value, el);
      else if (el.dataset.change)
        (actions[el.dataset.change] ?? app.actions?.[el.dataset.change])?.(el.dataset, el, state);
      else return;
      update();
    });
    root.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = event.target.dataset.submit;
      const fn = actions[name] ?? app.actions?.[name];
      if (fn) Promise.resolve(fn(event.target.dataset, event.target, state)).then(update);
      update();
    });
    window.addEventListener("hashchange", () => {
      route();
      update();
      app.onRoute?.(state);
    });
    route();
    update();
  }
  function route() {
    state.route = parseHash();
    // Story: the owner just added "unable_to_fix" to Debug (unsaved) and hasn't said where it goes.
    if (state.route.view === "editor" && state.route.id && state.route.id !== state.draftId) {
      if (state.route.id === "draft-new" && state.newDraft) {
        state.draft = state.newDraft;
        state.saved = "";
        state.savedRevision = 0;
        state.draftId = "draft-new";
        state.selectedStep = state.draft.steps[0].id;
      } else loadSample();
    }
    if (state.route.runEdit && state.draftId !== "run-edit") {
      loadSample();
      state.draft = JSON.parse(state.saved);
      state.draftId = "run-edit";
      state.selectedStep = "review";
    }
    state.editorMode = state.route.runEdit ? "run" : "workflow";
    if (
      state.route.view === "run" &&
      state.route.id !== "run_8c1e2f40" &&
      state.route.id !== "run_4d2b9e07"
    ) {
      state.route.id = "run_8c1e2f40";
    }
  }

  const api = {
    TEMPLATES,
    DATA,
    KIND,
    OUTCOME_HELP,
    SYSTEM_LABELS,
    STATUS,
    h,
    humanize,
    slug,
    outcomesOf,
    stepById,
    stepName,
    effectiveRule,
    actionKey,
    describeAction,
    validate,
    toYaml,
    runView,
    dirty,
    actions,
    fb: (key) => state.fb[key],
    isBusy: (key) => !!state.busy[key],
    fbHtml: (key, cls = "fb") => {
      const f = state.fb[key];
      if (!f) return `<span class="${cls}" role="status" aria-live="polite"></span>`;
      return `<span class="${cls} ${cls}-${f.kind}" role="${f.kind === "error" ? "alert" : "status"}" aria-live="polite">${f.kind === "pending" ? '<span class="spinner" aria-hidden="true"></span>' : ""}${h(f.text)}</span>`;
    },
    /** Destination options for an outcome select. */
    ruleOptions(draft, step, outcome) {
      const own = step.on?.[outcome];
      const bare = { ...step, on: { ...step.on } };
      delete bare.on[outcome];
      const inherited = effectiveRule(draft, bare, outcome);
      const current = own ? actionKey(own) : inherited ? "inherit" : "";
      const opt = (value, label) =>
        `<option value="${h(value)}" ${current === value ? "selected" : ""}>${h(label)}</option>`;
      const steps = draft.steps.filter((s) => s.kind !== "end");
      const ends = draft.steps.filter((s) => s.kind === "end");
      return [
        current === "" ? opt("", "Choose what happens…") : "",
        inherited
          ? opt(
              "inherit",
              `Use ${inherited.label?.toLowerCase() ?? "shared rule"}: ${describeAction(draft, inherited.action)}`,
            )
          : "",
        `<optgroup label="Continue">${steps.map((s) => opt(`goto:${s.id}`, `Go to ${humanize(s.id)}${s.id === step.id ? " (this step again)" : ""}`)).join("")}</optgroup>`,
        ends.length
          ? `<optgroup label="Finish">${ends.map((s) => opt(`goto:${s.id}`, stepName(draft, s.id))).join("")}</optgroup>`
          : "",
        `<optgroup label="Other">${opt("pause", "Pause and wait for me")}${opt("retry", "Retry this step")}${opt("new", "＋ New step…")}</optgroup>`,
      ].join("");
    },
    /** Inline form shown after choosing "＋ New step…" as an outcome destination. */
    newStepForm(cls = "newstep") {
      const pending = state.ui.newStepFor;
      if (!pending) return "";
      return `<div class="${cls}" role="group" aria-label="Add a step for this result">
        <p>New step for <strong>${h(humanize(pending.step))}</strong> → <code>${h(pending.outcome)}</code></p>
        <input data-new-step-name data-focus="newstep-name" placeholder="Step name, e.g. Write tests" aria-label="New step name" />
        <div class="newstep-kinds">
          <button type="button" data-act="addStep" data-kind="agent" data-after="${h(pending.step)}">Agent step</button>
          <button type="button" data-act="addStep" data-kind="command" data-after="${h(pending.step)}">Command</button>
          <button type="button" data-act="ui" data-key="newStepFor" data-value="null" class="quiet">Cancel</button>
        </div></div>`;
    },
    get state() {
      return state;
    },
    update,
  };
  window.WFZ_KIT = { ...api, mount };
})();
