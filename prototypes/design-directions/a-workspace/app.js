/* PROTOTYPE — Direction A: Developer workspace. Sample data only; no daemon calls. */
(() => {
  const K = window.WFZ_KIT;
  const { h, humanize, KIND } = K;
  const ICON = { agent: "◆", command: "›_", "task.next": "☰", "task.complete": "✓", end: "■" };

  function shell(state, crumbs, actions, body) {
    const v = state.route.view;
    const attention = state.runs.filter((r) => ["paused", "interrupted"].includes(r.status)).length;
    return `
    <div class="layout">
      <nav class="side" aria-label="Main">
        <div class="brand">Workflowz</div>
        <a href="#/workflows" class="navlink ${v === "workflows" || v === "editor" ? "current" : ""}" ${v === "workflows" || v === "editor" ? 'aria-current="page"' : ""}>Workflows</a>
        <a href="#/runs" class="navlink ${v === "runs" || v === "run" ? "current" : ""}" ${v === "runs" || v === "run" ? 'aria-current="page"' : ""}>Runs ${attention ? `<span class="badge" title="${attention} need attention">${attention}</span>` : ""}</a>
        <div class="side-foot">${
          state.sim.disconnected
            ? '<span class="dot dot-danger"></span>Disconnected<br/><small>Runs keep going in the daemon.</small>'
            : '<span class="dot dot-ok"></span>Daemon connected<br/><small>127.0.0.1 · this browser paired</small>'
        }</div>
      </nav>
      <div class="main">
        ${state.sim.disconnected ? '<div class="conn-banner" role="alert"><strong>Lost connection to the daemon.</strong> Execution continues in the daemon. Edits stay in this tab; actions are disabled until you reconnect. <button type="button" data-act="sim" data-key="disconnected">Reconnect</button></div>' : ""}
        <header class="topbar">
          <ol class="crumbs" aria-label="You are here">${crumbs.map((c, i) => `<li>${c.href && i < crumbs.length - 1 ? `<a href="${c.href}">${h(c.label)}</a>` : `<span ${i === crumbs.length - 1 ? 'aria-current="location"' : ""}>${h(c.label)}</span>`}</li>`).join("")}</ol>
          <div class="top-actions">${actions}</div>
        </header>
        ${body}
      </div>
    </div>`;
  }

  /* ---------------- Workflows ---------------- */
  function workflows(state) {
    const rows = K.DATA.workflows
      .map(
        (w) => `<tr>
        <td><a class="strong" href="#/workflows/${w.id}">${h(w.name)}</a><div class="muted">${h(w.description)}</div></td>
        <td class="mono">${h(w.project)}</td>
        <td>${w.stepCount} steps</td>
        <td>Revision ${w.revision}<div class="muted">${h(w.saved)}</div></td>
        <td><a href="#/runs">${w.runCount} run${w.runCount === 1 ? "" : "s"}</a></td>
        <td class="right"><a class="btn btn-sm" href="#/workflows/${w.id}">Open</a></td>
      </tr>`,
      )
      .join("");
    return shell(
      state,
      [{ label: "Workflows" }],
      `<a class="btn btn-primary" href="#/workflows/new">＋ Create workflow</a>`,
      `<main class="page">
        <h1>Workflows</h1>
        <p class="lede">A workflow is a saved list of steps. Open one to edit it or create a run from it.</p>
        <table class="table"><thead><tr><th>Name</th><th>Project</th><th>Steps</th><th>Latest save</th><th>Runs</th><th></th></tr></thead><tbody>${rows}</tbody></table>
        <h2 class="h2">Start from an example</h2>
        <div class="cards">${K.DATA.examples.map((e, i) => `<button type="button" class="card" data-act="startFrom" data-template="${["single", "loop", "commands"][i]}"><strong>${h(e.name)}</strong><span class="muted">${h(e.description)}</span></button>`).join("")}</div>
      </main>`,
    );
  }

  /* ---------------- New workflow ---------------- */
  function newWorkflow(state) {
    const t = state.ui.newTemplate ?? "single";
    const opts = [
      ["single", "Single agent step", "One prompt, one agent, then finish."],
      ["loop", "Task loop", "Work through a Markdown checklist one task at a time."],
      ["commands", "Commands only", "Run programs in order. No agents."],
    ];
    return shell(
      state,
      [{ label: "Workflows", href: "#/workflows" }, { label: "New workflow" }],
      "",
      `<main class="page"><div class="narrow"><section class="panel">
        <h1>New workflow</h1><p class="lede">Three things to start. You can change all of them in the editor.</p>
        <form data-submit="newDraft">
          <label class="block">Name<input data-bind="ui.newName" data-focus="new-name" value="${h(state.ui.newName ?? "")}" placeholder="e.g. Fix failing tests" /></label>
          <label class="block">Project folder<input class="mono" data-bind="ui.newRoot" value="${h(state.ui.newRoot ?? "")}" placeholder="/home/you/code/project" /><span class="hint">Agents and commands work in this folder. It's on the daemon's machine.</span></label>
          <fieldset class="choices"><legend>Start from</legend>${opts.map(([k, l, d]) => `<label class="choice ${t === k ? "current" : ""}"><input type="radio" name="tpl" data-bind="ui.newTemplate" value="${k}" ${t === k ? "checked" : ""}/><span><strong>${l}</strong><span class="muted">${d}</span></span></label>`).join("")}</fieldset>
          <div class="form-actions"><button class="btn btn-primary" type="submit">Create draft</button>${K.fbHtml("new")}<a class="btn btn-quiet" href="#/workflows">Cancel</a></div>
        </form></section></div></main>`,
    );
  }

  /* ---------------- Editor ---------------- */
  function editor(state) {
    const d = state.draft;
    const issues = K.validate(d);
    const errors = issues.filter((i) => i.severity === "error");
    const tab = state.ui.tab ?? "steps";
    const runMode = state.editorMode === "run";
    const dirty = K.dirty();
    const status = runMode
      ? `<span class="pill pill-attention">Editing run ${h(state.route.runEdit)} · applies to future steps only</span>`
      : !state.savedRevision
        ? `<span class="pill pill-attention">New draft</span><span class="muted"> · not saved yet</span>`
        : dirty
          ? `<span class="pill pill-attention">Unsaved changes</span><span class="muted"> · based on revision ${state.savedRevision}</span>`
          : `<span class="pill pill-success">Saved</span><span class="muted"> · revision ${state.savedRevision}</span>`;
    const crumbs = runMode
      ? [
          { label: "Runs", href: "#/runs" },
          { label: state.route.runEdit, href: `#/runs/${state.route.runEdit}` },
          { label: "Edit workflow for this run" },
        ]
      : [{ label: "Workflows", href: "#/workflows" }, { label: d.name || "Untitled workflow" }];
    const actions = runMode
      ? `<a class="btn" href="#/runs/${h(state.route.runEdit)}">Cancel</a>`
      : `<span class="act-group">${K.fbHtml("validate")}<button type="button" class="btn" data-act="validate" ${K.isBusy("validate") ? "disabled" : ""}>Check</button></span>
         <span class="act-group">${K.fbHtml("save")}<button type="button" class="btn ${dirty ? "btn-primary" : ""}" data-act="save" ${K.isBusy("save") || !dirty ? "disabled" : ""}>Save</button></span>
         <span class="act-group">${K.fbHtml("create")}<button type="button" class="btn ${dirty ? "" : "btn-primary"}" data-act="createRun" ${K.isBusy("create") ? "disabled" : ""} title="${dirty ? "Save first" : "Prepares a run; you start it on the next screen"}">Create run…</button></span>`;
    const tabs = [
      ["steps", "Steps", errors.filter((e) => e.stepId).length],
      ["project", "Project", errors.filter((e) => e.field === "project").length],
      ["rules", "Rules & limits", 0],
      ["yaml", "YAML", 0],
    ];
    let body = "";
    if (tab === "steps") body = stepsTab(state, issues);
    if (tab === "project") body = projectTab(state);
    if (tab === "rules") body = rulesTab(state);
    if (tab === "yaml") body = yamlTab(state);
    return shell(
      state,
      crumbs,
      actions,
      `<main class="page page-editor">
        <div class="editor-head">
          <input class="title-input" data-bind="draft.name" value="${h(d.name)}" aria-label="Workflow name" />
          <div class="status-line">${status}</div>
        </div>
        ${runMode ? runRevisionBar(state) : ""}
        <div class="tabs" role="tablist">${tabs.map(([id, label, n]) => `<button type="button" role="tab" aria-selected="${tab === id}" class="tab ${tab === id ? "current" : ""}" data-act="ui" data-key="tab" data-value="${id}">${label}${n ? ` <span class="count-err">${n}</span>` : ""}</button>`).join("")}</div>
        ${body}
      </main>`,
    );
  }

  function runRevisionBar(state) {
    return `<div class="callout callout-attention">
      <p><strong>You are editing the workflow of a paused run.</strong> Changes apply to this run's future steps only; finished steps, tasks and history stay as they are. Files are not changed. The run stays paused until you Resume.</p>
      <div class="inline-form">
        <label>Reason (saved in run history) <input data-bind="ui.revisionReason" value="${h(state.ui.revisionReason ?? "")}" placeholder="e.g. Clarify CSV number formatting in review prompt" /></label>
        <span class="act-group">${K.fbHtml("save")}<button type="button" class="btn btn-primary" data-act="save">Apply to run</button></span>
      </div></div>`;
  }

  function stepsTab(state, issues) {
    const d = state.draft;
    const sel = K.stepById(d, state.selectedStep) ?? d.steps[0];
    const list = d.steps
      .map((s, i) => {
        const bad = issues.some((x) => x.stepId === s.id && x.severity === "error");
        const meta =
          s.kind === "agent"
            ? `${s.harness}${s.model ? ` · ${s.model.split("/").pop()}` : ""}`
            : s.kind === "command"
              ? s.argv.join(" ")
              : KIND[s.kind].short;
        return `<li><button type="button" class="step-item ${s.id === sel.id ? "current" : ""}" data-act="selectStep" data-step="${s.id}" aria-current="${s.id === sel.id}">
          <span class="num">${i + 1}</span><span class="icon k-${s.kind.replace(".", "-")}" aria-hidden="true">${ICON[s.kind]}</span>
          <span class="step-text"><span class="step-name">${h(humanize(s.id))}${d.start === s.id ? ' <span class="tag">first</span>' : ""}</span><span class="step-meta">${h(meta)}</span></span>
          ${bad ? '<span class="err-dot" title="Needs attention">!</span>' : ""}
        </button></li>`;
      })
      .join("");
    const problems = issues.length
      ? issues
          .map(
            (i) =>
              `<li><button type="button" class="problem ${i.severity}" data-act="selectStep" data-step="${i.stepId ?? sel.id}"><span>${i.severity === "error" ? "●" : "○"}</span>${h(i.text)}</button></li>`,
          )
          .join("")
      : '<li class="muted">No problems. You can save.</li>';
    return `<div class="three">
      <section class="pane pane-list" aria-label="Steps in order">
        <div class="pane-head"><h2>Steps</h2><span class="muted">${d.steps.length}</span></div>
        <ol class="steps" data-scroll="steps">${list}</ol>
        <div class="add-row">
          ${
            state.ui.adding
              ? `<input data-new-step-name data-focus="add-name" placeholder="Name, e.g. Run tests" aria-label="New step name"/>
            <div class="add-kinds">${["agent", "command", "task.next", "task.complete", "end"].map((k) => `<button type="button" class="btn btn-sm" data-act="addStep" data-kind="${k}">${KIND[k].label}</button>`).join("")}
            <button type="button" class="btn btn-sm btn-quiet" data-act="ui" data-key="adding" data-value="null">Cancel</button></div>`
              : `<button type="button" class="btn btn-sm" data-act="ui" data-key="adding" data-value="toggle">＋ Add step after “${h(humanize(sel.id))}”</button>`
          }
          ${K.fbHtml("step")}
        </div>
      </section>
      <section class="pane pane-form" aria-label="Selected step" data-scroll="form">${stepForm(state, sel, issues)}</section>
      <aside class="pane pane-side" aria-label="Checks">
        <div class="pane-head"><h2>Checks</h2></div>
        <ul class="problems">${problems}</ul>
        <h3 class="h3">Runs first</h3>
        <select data-bind="draft.start" aria-label="First step">${d.steps.map((s) => `<option value="${s.id}" ${d.start === s.id ? "selected" : ""}>${h(humanize(s.id))}</option>`).join("")}</select>
        <p class="hint">Steps run one at a time. After each step, its result decides what runs next — order in this list is only for reading.</p>
      </aside>
    </div>`;
  }

  function outcomeTable(state, step) {
    const d = state.draft;
    const rows = K.outcomesOf(step)
      .map((o) => {
        const own = step.on?.[o];
        const eff = K.effectiveRule(d, step, o);
        const missing = !eff;
        const retry = own?.retry;
        return `<tr class="${missing ? "row-missing" : ""}">
          <th scope="row"><code>${h(o)}</code>${K.OUTCOME_HELP[o] ? `<div class="muted">${h(K.OUTCOME_HELP[o])}</div>` : ""}</th>
          <td><select data-rule="${step.id}|${o}" data-rule-key="${step.id}|${o}" aria-label="When result is ${h(o)}" class="${missing ? "invalid" : ""}">${K.ruleOptions(d, step, o)}</select>
            ${missing ? '<div class="field-err">Choose where the run goes for this result.</div>' : ""}
            ${!own && eff ? `<div class="muted">From ${h(eff.label.toLowerCase())}</div>` : ""}
            ${retry ? `<div class="retry-fields"><label>Runs in total <input type="number" min="2" data-bind="step.${step.id}.retry.${o}:max_attempts" value="${retry.max_attempts}"/></label><label>Wait (s) <input type="number" min="0" data-bind="step.${step.id}.retry.${o}:backoff_seconds" value="${retry.backoff_seconds}"/></label></div>` : ""}
          </td>
          <td class="right">${step.kind === "agent" ? `<button type="button" class="btn-icon" data-act="removeOutcome" data-step="${step.id}" data-outcome="${h(o)}" aria-label="Remove result ${h(o)}">✕</button>` : ""}</td>
        </tr>`;
      })
      .join("");
    const add =
      step.kind === "agent"
        ? `<div class="inline-form"><input data-new-outcome="${step.id}" data-focus="new-outcome" placeholder="New result, e.g. needs_info" aria-label="New result name"/><button type="button" class="btn btn-sm" data-act="addOutcome" data-step="${step.id}">Add result</button>${K.fbHtml(`outcome:${step.id}`)}</div>`
        : "";
    return `<table class="table outcomes"><thead><tr><th>When the result is</th><th>Then</th><th></th></tr></thead><tbody>${rows}</tbody></table>${K.newStepForm("newstep callout")}${add}`;
  }

  function failureSection(state, step) {
    if (step.kind !== "agent" && step.kind !== "command") return "";
    const d = state.draft;
    const sysOwn = Object.keys(step.on ?? {}).filter((k) => k.startsWith("system."));
    const any = K.effectiveRule(d, step, "system.error");
    return `<details class="disclosure"><summary>If something goes wrong technically <span class="muted">— ${h(K.describeAction(d, any?.action ?? { pause: true }))}${sysOwn.length ? ` · ${sysOwn.length} specific rule` : ""}</span></summary>
      <p class="hint">Technical failures are crashes, timeouts or missing reports — not results the ${step.kind === "agent" ? "agent" : "command"} chose.</p>
      <table class="table outcomes"><tbody>${[
        "system.error",
        "system.timeout",
        "system.report_error",
      ]
        .filter((o) => step.kind === "agent" || o !== "system.report_error")
        .map(
          (
            o,
          ) => `<tr><th scope="row">${h(K.SYSTEM_LABELS[o])}<div class="muted mono">${o}</div></th><td><select data-rule="${step.id}|${o}" aria-label="${h(K.SYSTEM_LABELS[o])}">${K.ruleOptions(d, step, o)}</select>
          ${step.on?.[o]?.retry ? `<div class="retry-fields"><label>Runs in total <input type="number" min="2" data-bind="step.${step.id}.retry.${o}:max_attempts" value="${step.on[o].retry.max_attempts}"/></label><label>Wait (s) <input type="number" min="0" data-bind="step.${step.id}.retry.${o}:backoff_seconds" value="${step.on[o].retry.backoff_seconds}"/></label></div>` : ""}</td></tr>`,
        )
        .join("")}</tbody></table></details>`;
  }

  function stepForm(state, step, issues) {
    const d = state.draft;
    const errs = (field) =>
      issues
        .filter((i) => i.stepId === step.id && i.field === field)
        .map((i) => `<div class="field-err">${h(i.text)}</div>`)
        .join("");
    const head = `<div class="form-head">
      <div><div class="kind-label">${KIND[step.kind].label}</div><h2 tabindex="-1" data-step-title="${step.id}">${h(humanize(step.id))}</h2><div class="muted">${KIND[step.kind].hint} <span class="mono">id: ${h(step.id)}</span></div></div>
      <div class="form-tools"><button type="button" class="btn-icon" data-act="moveStep" data-step="${step.id}" data-dir="-1" aria-label="Move up">↑</button><button type="button" class="btn-icon" data-act="moveStep" data-step="${step.id}" data-dir="1" aria-label="Move down">↓</button><button type="button" class="btn btn-sm btn-quiet" data-act="deleteStep" data-step="${step.id}">Delete</button></div>
    </div>`;
    let fields = "";
    if (step.kind === "agent") {
      const harness = K.DATA.harnesses.find((x) => x.id === step.harness);
      fields = `<div class="grid2">
        <label>Agent<select data-bind="step.${step.id}.harness">${K.DATA.harnesses.map((x) => `<option value="${x.id}" ${x.id === step.harness ? "selected" : ""}>${x.label}</option>`).join("")}</select></label>
        <label>Model<input list="models-${step.id}" data-bind="step.${step.id}.model" value="${h(step.model)}" placeholder="Agent's default model"/><datalist id="models-${step.id}">${harness.models.map((m) => `<option value="${h(m)}"></option>`).join("")}</datalist></label>
        <label>Reasoning effort<select data-bind="step.${step.id}.reasoning_effort">${["", "low", "medium", "high"].map((r) => `<option value="${r}" ${step.reasoning_effort === r ? "selected" : ""}>${r || "Agent default"}</option>`).join("")}</select></label>
        <label>Conversation<select data-bind="step.${step.id}.session"><option value="fresh" ${step.session === "fresh" ? "selected" : ""}>Start a new conversation</option><option value="resume" ${step.session === "resume" ? "selected" : ""}>Continue this agent's last conversation for the task</option></select></label>
      </div>
      <p class="perm">Runs with <strong>unrestricted permissions</strong> (${h(harness.permission)}). It can change any file you can.</p>
      <label class="block">Prompt${errs("prompt")}<textarea rows="7" data-bind="step.${step.id}.prompt" class="${errs("prompt") ? "invalid" : ""}" placeholder="Describe the work. Use {{task.text}} for the current task.">${h(step.prompt)}</textarea></label>
      <div class="chips" aria-label="Values you can insert"><span class="muted">Insert:</span> <code>{{task.text}}</code> <code>{{task.id}}</code> <code>{{reports.implement.summary}}</code> <code>{{project.root}}</code></div>`;
    }
    if (step.kind === "command") {
      fields = `<label class="block">Command — one argument per line${errs("argv")}<textarea rows="4" class="mono" data-bind="step.${step.id}.argvText">${h(step.argv.join("\n"))}</textarea></label>
        <p class="muted">Runs as: <code>${h(step.argv.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" "))}</code> in the project folder. No shell: pipes and <code>&amp;&amp;</code> are not interpreted.</p>`;
    }
    if (step.kind === "end")
      fields = `<label class="block">Finish label<input data-bind="step.${step.id}.label" value="${h(step.label ?? "")}" placeholder="Shown when the run completes"/></label>`;
    const next =
      step.kind === "end"
        ? ""
        : `<h3 class="h3">What happens next</h3>${outcomeTable(state, step)}${failureSection(state, step)}`;
    const adv =
      step.kind === "agent"
        ? `<details class="disclosure"><summary>Advanced <span class="muted">— context, tags, timeout</span></summary>
          <fieldset class="checks"><legend>Give the agent the latest report from</legend>${d.steps
            .filter((s) => s.kind === "agent" && s.id !== step.id)
            .map(
              (s) =>
                `<label><input type="checkbox" data-bind="step.${step.id}.reports.${s.id}" ${step.include_reports.includes(s.id) ? "checked" : ""}/> ${h(humanize(s.id))}</label>`,
            )
            .join("")}</fieldset>
          <div class="grid2"><label>Tags (comma separated)<input data-bind="step.${step.id}.tagsText" value="${h(step.tags.join(", "))}"/></label>
          <label>Time limit (seconds)<input type="number" data-bind="step.${step.id}.timeout_seconds" value="${step.timeout_seconds ?? ""}" placeholder="No limit"/></label></div></details>`
        : "";
    return head + fields + next + adv;
  }

  function projectTab(state) {
    const p = state.draft.project;
    return `<div class="narrow"><section class="panel">
      <h2>Project</h2><p class="muted">Where the steps work and what they read. Paths can be relative to the project folder.</p>
      <label class="block">Project folder<input class="mono" data-bind="draft.project.root" value="${h(p.root)}"/></label>
      <label class="block">Instruction files given to every agent — one per line, in order<textarea rows="3" class="mono" data-bind="draft.project.instructionsText">${h(p.instructions.join("\n"))}</textarea></label>
      <label class="block">Task checklist (Markdown)<input class="mono" data-bind="draft.project.tasksPath" value="${h(p.tasksPath)}" placeholder="Leave empty if this workflow has no tasks"/></label>
      <p class="hint">Tasks are copied when you create a run. Editing todo.md later doesn't change an existing run, and Workflowz never ticks boxes in the file.</p>
      <details class="disclosure"><summary>Workflow folder <span class="muted">— ${h(state.draft.workflowDir)}</span></summary><p class="hint">Relative paths in the YAML resolve from this folder on the daemon's machine.</p><input class="mono" data-bind="draft.workflowDir" value="${h(state.draft.workflowDir)}"/></details>
    </section></div>`;
  }

  function rulesTab(state) {
    const d = state.draft;
    return `<div class="narrow">
      <section class="panel"><h2>Shared rules</h2><p class="muted">Apply the same “what happens next” to many steps. A rule set on a step itself always wins.</p>
      ${d.policies
        .map(
          (p, i) =>
            `<div class="rule-card"><div><strong>Steps tagged ${p.match.tags ? p.match.tags.map((t) => `<span class="tag">${h(t)}</span>`).join(" ") : "…"}</strong></div>${Object.entries(
              p.on,
            )
              .map(
                ([o, a]) => `<div>Result <code>${h(o)}</code> → ${h(K.describeAction(d, a))}</div>`,
              )
              .join("")}<div class="muted">Applies to: ${d.steps
              .filter((s) => s.tags?.some((t) => p.match.tags?.includes(t)))
              .map((s) => humanize(s.id))
              .join(", ")} · rule ${i + 1}</div></div>`,
        )
        .join("")}
      <button type="button" class="btn btn-sm">＋ Add shared rule</button></section>
      <section class="panel"><h2>Workflow defaults</h2>
        <p>Any technical failure → <strong>${h(K.describeAction(d, d.defaults.on["system.error"]))}</strong> <span class="muted">(unless a step or shared rule says otherwise)</span></p>
        <label class="row"><input type="checkbox" ${d.defaults.report_correction_attempts ? "checked" : ""}/> If an agent finishes without reporting, ask it once to send its report</label></section>
      <section class="panel"><h2>Safety limits</h2><p class="muted">The run pauses when a limit is reached. Needed when results can loop back.</p>
        <div class="grid2"><label>Max step runs<input type="number" data-bind="draft.limits.max_step_executions" value="${d.limits.max_step_executions ?? ""}"/></label>
        <label>Max total time (hours)<input type="number" value="${(d.limits.max_wall_time_seconds ?? 0) / 3600 || ""}"/></label>
        <label>Pause agent after silence (s)<input type="number" data-bind="draft.limits.agent_idle_timeout_seconds" value="${d.limits.agent_idle_timeout_seconds ?? ""}" placeholder="Off"/></label></div></section>
    </div>`;
  }

  function yamlTab(state) {
    return `<div class="narrow"><section class="panel"><div class="pane-head"><h2>YAML</h2><button type="button" class="btn btn-sm">Edit as text…</button></div>
      <p class="muted">This is exactly what will be saved. Editing as text pauses the visual editor until you check the text.</p>
      <pre class="yaml">${h(K.toYaml(state.draft))}</pre></section></div>`;
  }

  /* ---------------- Runs ---------------- */
  function chip(status) {
    return `<span class="chip chip-${K.STATUS[status].tone}">${K.STATUS[status].label}</span>`;
  }
  function runs(state) {
    const filter = state.ui.runFilter ?? "all";
    const groups = {
      all: () => true,
      attention: (r) => ["paused", "interrupted"].includes(r.status),
      active: (r) => ["ready", "running", "pausing"].includes(r.status),
      done: (r) => ["completed", "stopped"].includes(r.status),
    };
    const list = state.runs.filter(groups[filter]);
    return shell(
      state,
      [{ label: "Runs" }],
      "",
      `<main class="page"><h1>Runs</h1><p class="lede">Each run is one execution of a saved workflow revision. Open a run to start, follow or intervene.</p>
      <div class="seg" role="group" aria-label="Filter runs">${[
        ["all", "All"],
        ["attention", "Needs attention"],
        ["active", "Ready & running"],
        ["done", "Finished"],
      ]
        .map(
          ([k, l]) =>
            `<button type="button" class="seg-btn ${filter === k ? "current" : ""}" aria-pressed="${filter === k}" data-act="ui" data-key="runFilter" data-value="${k}">${l}</button>`,
        )
        .join("")}</div>
      <table class="table runs"><thead><tr><th>Status</th><th>Workflow</th><th>Progress</th><th>Now at</th><th>Updated</th><th></th></tr></thead><tbody>
      ${list.map((r) => `<tr class="${state.ui.highlightRun === r.id ? "row-new" : ""}"><td>${chip(r.status)}<div class="muted">${h(r.note)}</div></td><td><a class="strong" href="#/runs/${r.id}">${h(r.workflow)}</a><div class="muted mono">${r.id} · rev ${r.revision} · ${h(r.project)}</div></td><td>${r.progress ? `${r.progress[0]} / ${r.progress[1]} tasks` : "—"}</td><td>${h(humanize(r.step))}</td><td>${h(r.updated)}</td><td class="right"><a class="btn btn-sm" href="#/runs/${r.id}">Open</a></td></tr>`).join("") || '<tr><td colspan="6" class="muted">No runs here.</td></tr>'}
      </tbody></table></main>`,
    );
  }

  /* ---------------- Run details ---------------- */
  function runPage(state) {
    const v = K.runView(state);
    const r = state.run;
    const fresh = state.route.id === "run_4d2b9e07";
    const name = fresh ? state.draft.name : "Implement, review and commit";
    const controls = runControls(state, v);
    const tasks = K.DATA.tasks;
    const groups = [];
    for (const item of v.items) {
      const key = item.task ?? "end";
      let g = groups.find((x) => x.key === key);
      if (!g) {
        g = { key, items: [] };
        groups.push(g);
      }
      g.items.push(item);
    }
    const sel = v.items.find((i) => i.id === r.selected) ?? v.items.at(-1);
    const openGroups = state.ui.openGroups ?? {};
    const history = groups
      .map((g) => {
        const task = tasks.find((t) => t.n === g.key);
        const done =
          g.items.some((i) => i.step === "mark_done") || (g.key === 3 && r.markedComplete);
        const open = openGroups[g.key] ?? (!done || g.items.some((i) => i.id === sel?.id));
        return `<li class="group"><button type="button" class="group-head" data-act="toggleGroup" data-group="${g.key}" aria-expanded="${open}">
          <span class="caret" aria-hidden="true">${open ? "▾" : "▸"}</span><span>${task ? `Task ${task.n}: ${h(task.text)}` : "End of tasks"}</span><span class="muted">${done ? "✓ done" : ""} ${g.items.length} step${g.items.length > 1 ? "s" : ""}</span></button>
          ${open ? `<ol class="items">${g.items.map((i) => historyRow(i, sel)).join("")}</ol>` : ""}</li>`;
      })
      .join("");
    const body = `<main class="page page-run">
      <section class="run-head">
        <div class="run-title"><div class="kind-label">${h(name)} · <span class="mono">${state.route.id}</span> · revision ${fresh ? state.savedRevision : 12}</div>
          <h1>${chip(v.status)} ${h(v.headline)}</h1><p class="lede">${h(v.detail)}</p>
          ${K.fbHtml("run", "fb fb-banner")}</div>
        <dl class="facts"><div><dt>Task</dt><dd>${v.currentTask ? `3 of 5 · ${h(v.currentTask.text)}` : v.status === "ready" ? "0 of 5 · not started" : "All 5 done"}</dd></div>
          <div><dt>Next / current step</dt><dd>${h(humanize(v.cursor))}</dd></div><div><dt>Elapsed</dt><dd>${v.elapsed} <span class="muted">incl. pauses</span></dd></div>
          <div><dt>Progress</dt><dd><span class="bar"><span class="bar-fill" style="width:${v.tasksDone * 20}%"></span></span> ${v.tasksDone}/5 tasks</dd></div></dl>
      </section>
      ${controls}
      ${
        v.status === "ready"
          ? readyPlan(state)
          : `<div class="split">
        <section class="pane" aria-label="History"><div class="pane-head"><h2>What happened</h2><span class="muted">${v.items.length} steps</span></div><ol class="history" data-scroll="history">${history}</ol></section>
        <section class="pane" aria-label="Step details" data-scroll="detail">${sel ? itemDetail(state, sel) : '<p class="muted">Select a step.</p>'}</section>
      </div>`
      }
    </main>`;
    return shell(
      state,
      [{ label: "Runs", href: "#/runs" }, { label: `${name} · ${state.route.id}` }],
      "",
      body,
    );
  }

  function historyRow(i, sel) {
    const status = i.running
      ? '<span class="chip chip-active">running</span>'
      : i.interrupted
        ? '<span class="chip chip-danger">interrupted</span>'
        : i.stopped
          ? '<span class="chip chip-neutral">stopped</span>'
          : i.manual
            ? '<span class="chip chip-attention">your action</span>'
            : `<code class="res res-${["blocked", "revise", "needs_debugging", "failed"].includes(i.outcome) ? "warn" : "ok"}">${h(i.outcome)}</code>`;
    const dest = i.manual ? "" : i.pause ? "→ paused" : i.to ? `→ ${h(humanize(i.to))}` : "";
    return `<li><button type="button" class="hist ${sel?.id === i.id ? "current" : ""}" data-act="selectItem" data-item="${i.id}" aria-current="${sel?.id === i.id}">
      <span class="t mono">${i.at}</span><span class="n">${h(i.manual ? i.note : humanize(i.step))}</span>${status}<span class="muted dest">${dest}</span><span class="muted d">${i.dur}</span></button></li>`;
  }

  function itemDetail(state, i) {
    const step = K.stepById(K.DATA.draft, i.step);
    const who =
      step.kind === "agent"
        ? `${K.DATA.harnesses.find((x) => x.id === step.harness).label}${step.model ? ` · ${step.model}` : ""}`
        : step.kind === "command"
          ? `$ ${step.argv.join(" ")}`
          : KIND[step.kind].label;
    let main = "";
    if (i.manual)
      main = `<p>${h(i.note)}</p><p class="muted">Recorded in the audit history. The run stayed paused.</p>`;
    else if (i.running)
      main = `<div class="callout"><span class="spinner"></span> Running for ${i.dur}. The result appears here when the agent reports.</div>`;
    else if (i.interrupted || i.stopped)
      main = `<div class="callout callout-danger">${i.stopped ? "Stopped before it reported. The process was terminated and cleaned up." : "No result. The daemon restarted while this step ran; its process is gone. Whether it changed files is unknown — check the project before deciding."}</div>`;
    else
      main = `<dl class="kv">
        <dt>Result</dt><dd><code>${h(i.outcome)}</code></dd>
        ${i.summary ? `<dt>Summary</dt><dd>${h(i.summary)}</dd>` : ""}
        ${i.issue ? `<dt>Issue</dt><dd>${h(i.issue)}</dd>` : ""}
        ${i.handoff ? `<dt>Handoff</dt><dd>${h(i.handoff)}</dd>` : ""}
        ${i.output !== undefined ? `<dt>Output</dt><dd><pre class="out">${h(i.output || "(no output)")}</pre></dd>` : ""}
        <dt>Then</dt><dd>${i.pause ? "Paused — rule: “blocked → Pause and wait for me”" : `Went to ${h(humanize(i.to))}`} <span class="muted">· ${h(i.ruleSource ?? "rule on this step")}</span></dd>
      </dl>`;
    return `<div class="detail-head"><div><div class="kind-label">${i.task ? `Task ${i.task}` : "Run"} · ${h(i.at)} · ${h(i.dur || "—")}</div><h2>${h(i.manual ? "Your action" : humanize(i.step))}</h2><div class="muted mono">${h(who)}</div></div></div>
      ${main}
      <details class="disclosure" ${state.run.raw ? "open" : ""}><summary data-act="toggleRaw">Technical details <span class="muted">— ${i.events.length} events</span></summary>
      <pre class="raw">${h(JSON.stringify(i.events, null, 2))}</pre></details>`;
  }

  function reasonForm(op, label, cls = "btn") {
    return `<form class="inline-form" data-submit="runControl" data-op="${op}"><input data-bind="ui.reason:${op}" placeholder="Reason (saved in history)" aria-label="Reason for ${label}" value="${h(K.state.ui[`reason:${op}`] ?? "")}"/><button class="${cls}" type="submit" ${K.isBusy(op) ? "disabled" : ""}>${label}</button>${K.fbHtml(op)}</form>`;
  }

  function runControls(state, v) {
    const ui = state.ui;
    const stop =
      ui.confirm === "stop"
        ? `<div class="confirm">${reasonForm("stop", "Stop now", "btn btn-danger")}<p class="hint">Terminates the running process and waits for it to exit. Changes already made to files stay.</p></div>`
        : `<button type="button" class="btn btn-quiet" data-act="ui" data-key="confirm" data-value="stop">Stop run…</button>`;
    if (v.status === "ready")
      return `<section class="controls"><span class="act-group"><button type="button" class="btn btn-primary btn-lg" data-act="runControl" data-op="start" ${K.isBusy("start") ? "disabled" : ""}>▶ Start</button>${K.fbHtml("start")}</span><span class="muted">Agents in this workflow run with unrestricted permissions: Codex, Claude Code, OpenCode.</span></section>`;
    if (v.status === "running")
      return `<section class="controls"><span class="act-group"><button type="button" class="btn" data-act="runControl" data-op="pause" ${K.isBusy("pause") ? "disabled" : ""}>Pause after this step</button>${K.fbHtml("pause")}</span>${stop}</section>`;
    if (v.status === "pausing")
      return `<section class="controls"><span class="muted">Waiting for Review to finish…</span>${stop}</section>`;
    if (v.status === "paused") {
      const target = ui.intervene;
      const extra =
        target === "jump"
          ? `<label>Go to<select data-bind="ui.interveneTarget"><option value="">Choose a step…</option>${K.DATA.draft.steps
              .filter((s) => s.kind !== "task.next")
              .map(
                (s) =>
                  `<option value="${s.id}" ${ui.interveneTarget === s.id ? "selected" : ""}>${h(humanize(s.id))}</option>`,
              )
              .join("")}</select></label>${reasonForm("jump", "Move run here")}`
          : target === "skip"
            ? `<label>Treat Review as if it reported<select data-bind="ui.interveneTarget"><option value="">Choose a result…</option>${["approved", "revise", "blocked"].map((o) => `<option ${ui.interveneTarget === o ? "selected" : ""}>${o}</option>`).join("")}</select></label>${ui.interveneTarget ? `<p class="hint">Then: ${h(K.describeAction(K.DATA.draft, K.effectiveRule(K.DATA.draft, K.stepById(K.DATA.draft, "review"), ui.interveneTarget)?.action))}. No agent runs.</p>` : ""}${reasonForm("skip", "Skip Review")}`
            : target === "complete-task"
              ? `<p class="hint">Records task 3 as done without running the remaining steps. Next: Pick task.</p>${reasonForm("complete-task", "Mark task 3 done")}`
              : "";
      return `<section class="controls controls-paused">
        <div class="decide"><h2 class="h3">Continue</h2>${reasonForm("resume", `▶ Resume — runs ${humanize(v.cursor)} ${v.cursor === "review" && !state.run.manual.length ? "again" : "next"}`, "btn btn-primary")}</div>
        <div class="decide"><h2 class="h3">Or change what runs next <span class="muted">(stays paused)</span></h2>
          <div class="seg">${[
            ["jump", "Move to a step"],
            ["skip", "Skip Review with a result"],
            ["complete-task", "Mark task done"],
          ]
            .map(
              ([k, l]) =>
                `<button type="button" class="seg-btn ${target === k ? "current" : ""}" aria-pressed="${target === k}" data-act="ui" data-key="intervene" data-value="${k}">${l}</button>`,
            )
            .join(
              "",
            )}<a class="seg-btn" href="#/runs/${state.route.id}/edit">Edit workflow for this run</a></div>
          ${extra ? `<div class="intervene">${extra}</div>` : ""}</div>
        <div class="decide">${stop}</div></section>`;
    }
    if (v.status === "interrupted")
      return `<section class="controls controls-paused"><div class="decide"><h2 class="h3">Recovery is done from the terminal for now</h2>
        <p class="hint">Choose retry, skip, jump or end explicitly. Nothing reruns automatically.</p><pre class="out">wf run recovery ${state.route.id}\nwf run recovery-decide ${state.route.id} --request decision.json</pre></div></section>`;
    return "";
  }

  function readyPlan(state) {
    const d = state.draft;
    return `<section class="pane plan"><h2>What will run</h2><ol class="plan-list">${d.steps
      .map(
        (s) =>
          `<li><strong>${h(humanize(s.id))}</strong> <span class="muted">${KIND[s.kind].label}${s.kind === "agent" ? ` · ${s.harness}` : ""}</span><div class="muted">${K.outcomesOf(
            s,
          )
            .map((o) => `${o} → ${K.describeAction(d, K.effectiveRule(d, s, o)?.action)}`)
            .join(" · ")}</div></li>`,
      )
      .join("")}</ol>
      <h3 class="h3">Tasks imported from todo.md</h3><ol>${K.DATA.tasks.map((t) => `<li>${h(t.text)}</li>`).join("")}</ol></section>`;
  }

  K.mount({
    render(state) {
      const v = state.route.view;
      if (v === "new") return newWorkflow(state);
      if (v === "editor") return editor(state);
      if (v === "runs") return runs(state);
      if (v === "run") return runPage(state);
      return workflows(state);
    },
    actions: {
      startFrom: ({ template }, _el, state) => {
        state.ui.newTemplate = template;
        K.actions.nav({ to: "workflows/new" });
      },
      toggleGroup: ({ group }, _el, state) => {
        state.ui.openGroups ??= {};
        const groups = state.ui.openGroups;
        const g = group === "end" ? "end" : Number(group);
        const items = K.runView(state).items.filter((i) => (i.task ?? "end") === g);
        const done = items.some((i) => i.step === "mark_done");
        const current = groups[g] ?? (!done || items.some((i) => i.id === state.run.selected));
        groups[g] = !current;
      },
    },
    onRoute(state) {
      document.title = `${
        {
          new: "New workflow",
          workflows: "Workflows",
          editor: "Edit workflow",
          runs: "Runs",
          run: "Run details",
        }[state.route.view]
      } — Workflowz (Prototype A)`;
      document.querySelector("main h1, main .title-input")?.focus({ preventScroll: true });
    },
  });
})();
