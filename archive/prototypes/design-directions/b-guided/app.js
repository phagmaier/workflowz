/* PROTOTYPE — Direction B: Guided builder. Sample data only; no daemon calls. */
(() => {
  const K = window.WFZ_KIT;
  const { h, humanize, KIND } = K;
  const ICON = { agent: "✦", command: "$", "task.next": "↳", "task.complete": "✓", end: "◼" };

  function shell(state, body) {
    const v = state.route.view;
    const wf = v === "workflows" || v === "editor" || v === "new";
    return `
    <header class="top">
      <a class="logo" href="#/workflows">Workflowz</a>
      <nav aria-label="Main"><a href="#/workflows" class="${wf ? "current" : ""}" ${wf ? 'aria-current="page"' : ""}>Workflows</a><a href="#/runs" class="${wf ? "" : "current"}" ${wf ? "" : 'aria-current="page"'}>Runs</a></nav>
      <span class="conn ${state.sim.disconnected ? "conn-bad" : ""}">${state.sim.disconnected ? "● Disconnected — runs continue in the daemon" : "● Connected"}</span>
    </header>
    ${state.sim.disconnected ? '<div class="conn-banner" role="alert">Can’t reach the Workflowz daemon. Your edits stay in this tab. <button type="button" data-act="sim" data-key="disconnected">Try again</button></div>' : ""}
    ${body}`;
  }

  /* ---------------- Workflows ---------------- */
  function workflows(state) {
    return shell(
      state,
      `<main class="col">
        <div class="hero"><div><h1>Your workflows</h1><p class="lede">A workflow is a recipe of steps. Make one, then create a run to execute it.</p></div>
        <a class="btn btn-primary btn-lg" href="#/workflows/new">Create a workflow</a></div>
        <ul class="wf-list">${K.DATA.workflows
          .map(
            (
              w,
            ) => `<li class="wf-card"><div><h2><a href="#/workflows/${w.id}">${h(w.name)}</a></h2><p>${h(w.description)}</p>
            <p class="meta">${w.stepCount} steps · ${h(w.project)} · saved ${h(w.saved)} · ${w.runCount} run${w.runCount > 1 ? "s" : ""}</p></div>
            <div class="wf-actions"><a class="btn" href="#/workflows/${w.id}">Edit</a><a class="btn btn-quiet" href="#/runs">See runs</a></div></li>`,
          )
          .join("")}</ul>
      </main>`,
    );
  }

  function newWorkflow(state) {
    const t = state.ui.newTemplate ?? "single";
    const opts = [
      ["single", "One agent does one job", "Write a prompt, pick an agent, done."],
      [
        "loop",
        "Work through a task list",
        "Each unchecked item in a Markdown checklist gets its own pass.",
      ],
      ["commands", "Run commands", "Build, test or lint without an agent."],
    ];
    return shell(
      state,
      `<main class="col col-narrow"><a class="back" href="#/workflows">← Workflows</a>
      <form class="card" data-submit="newDraft"><h1>Create a workflow</h1>
        <div class="q"><label for="nn">What should we call it?</label><input id="nn" data-bind="ui.newName" value="${h(state.ui.newName ?? "")}" placeholder="Fix failing tests"/></div>
        <div class="q"><label for="nr">Which project folder will it work in?</label><input id="nr" class="mono" data-bind="ui.newRoot" value="${h(state.ui.newRoot ?? "")}" placeholder="/home/you/code/project"/><p class="hint">Agents and commands run inside this folder and can change files in it.</p></div>
        <fieldset class="q"><legend>How should it start?</legend>${opts.map(([k, l, d]) => `<label class="option ${t === k ? "current" : ""}"><input type="radio" name="tpl" value="${k}" data-bind="ui.newTemplate" ${t === k ? "checked" : ""}/><span><strong>${l}</strong><br/><span class="muted">${d}</span></span></label>`).join("")}</fieldset>
        <div class="row-actions"><button class="btn btn-primary btn-lg" type="submit">Continue to steps</button>${K.fbHtml("new")}</div>
      </form></main>`,
    );
  }

  /* ---------------- Editor: guided sections ---------------- */
  const SECTIONS = [
    ["basics", "Basics", "Name and project"],
    ["steps", "Steps", "What runs, in what order"],
    ["safety", "Safety & shared rules", "Optional"],
    ["finish", "Review & save", "Check, save, create a run"],
  ];

  function editor(state) {
    const d = state.draft;
    const issues = K.validate(d);
    const errors = issues.filter((i) => i.severity === "error");
    const sec = state.ui.bsec ?? "steps";
    const runMode = state.editorMode === "run";
    const dirty = K.dirty();
    const status = runMode
      ? "Editing this run’s workflow"
      : !state.savedRevision
        ? "New draft — not saved yet"
        : dirty
          ? `Unsaved changes (last saved: revision ${state.savedRevision})`
          : `All changes saved · revision ${state.savedRevision}`;
    const badge = (id) => {
      if (id === "steps") {
        const n = errors.filter((e) => e.stepId).length;
        return n
          ? `<span class="sbadge bad">${n} to fix</span>`
          : '<span class="sbadge ok">✓</span>';
      }
      if (id === "basics")
        return errors.some((e) => !e.stepId)
          ? '<span class="sbadge bad">fix</span>'
          : '<span class="sbadge ok">✓</span>';
      return "";
    };
    const body = { basics: basics, steps: steps, safety: safety, finish: finish }[sec](
      state,
      issues,
    );
    return shell(
      state,
      `<div class="editor">
        <aside class="stepper" aria-label="Workflow sections">
          <a class="back" href="${runMode ? `#/runs/${h(state.route.runEdit)}` : "#/workflows"}">← ${runMode ? "Back to run" : "Workflows"}</a>
          <div class="draft-name">${h(d.name || "Untitled")}</div>
          <div class="draft-status ${dirty ? "warn" : ""}" role="status">${h(status)}</div>
          <ol>${SECTIONS.map(([id, label, sub], i) => `<li><button type="button" class="sec ${sec === id ? "current" : ""}" aria-current="${sec === id ? "step" : "false"}" data-act="ui" data-key="bsec" data-value="${id}"><span class="sec-n">${i + 1}</span><span><strong>${label}</strong> ${badge(id)}<br/><span class="muted">${sub}</span></span></button></li>`).join("")}</ol>
        </aside>
        <main class="col editor-main">${runMode ? runRevisionNote(state) : ""}${body}</main>
      </div>`,
    );
  }

  function runRevisionNote(state) {
    return `<div class="note note-warn"><strong>You’re changing the workflow for paused run ${h(state.route.runEdit)}.</strong> Only steps that haven’t run yet are affected. History, tasks and files stay as they are. Finish in “Review & save”.</div>`;
  }

  function basics(state) {
    const d = state.draft;
    return `<h1>Basics</h1>
      <div class="card">
        <div class="q"><label for="bn">Workflow name</label><input id="bn" data-bind="draft.name" value="${h(d.name)}"/></div>
        <div class="q"><label for="br">Project folder</label><input id="br" class="mono" data-bind="draft.project.root" value="${h(d.project.root)}"/><p class="hint">Steps run inside this folder.</p></div>
        <div class="q"><label for="bt">Task list <span class="muted">(optional)</span></label><input id="bt" class="mono" data-bind="draft.project.tasksPath" value="${h(d.project.tasksPath)}" placeholder="todo.md"/><p class="hint">A Markdown checklist. Each unchecked item becomes a task. Workflowz copies the list when you create a run and never edits the file.</p></div>
        <div class="q"><label for="bi">Files every agent should read first <span class="muted">(one per line)</span></label><textarea id="bi" rows="3" class="mono" data-bind="draft.project.instructionsText">${h(d.project.instructions.join("\n"))}</textarea></div>
      </div>
      <div class="row-actions"><button type="button" class="btn btn-primary" data-act="ui" data-key="bsec" data-value="steps">Next: steps →</button></div>`;
  }

  function sentence(_d, s) {
    if (s.kind === "agent")
      return `<strong>${h(K.DATA.harnesses.find((x) => x.id === s.harness).label)}</strong> ${h(
        s.prompt
          .split("\n")[0]
          .replace(/\{\{task\.text\}\}/g, "the task")
          .slice(0, 90) || "— no prompt yet",
      )}`;
    if (s.kind === "command") return `Runs <code>${h(s.argv.join(" "))}</code>`;
    if (s.kind === "end") return h(s.label || "The run finishes.");
    return h(KIND[s.kind].hint);
  }

  function thenLine(d, s) {
    return K.outcomesOf(s)
      .map((o) => {
        const r = K.effectiveRule(d, s, o);
        return `<span class="then ${r ? "" : "then-missing"}"><code>${h(o)}</code> → ${r ? h(K.describeAction(d, r.action)) : "<em>needs a choice</em>"}</span>`;
      })
      .join("");
  }

  function steps(state, issues) {
    const d = state.draft;
    const open = state.selectedStep;
    const between = (after) =>
      state.ui.insertAfter === after
        ? `<div class="insert" role="group" aria-label="Choose a step type"><input data-new-step-name data-focus="ins-name" placeholder="Name it (optional)" aria-label="New step name"/>${["agent", "command", "task.next", "task.complete", "end"].map((k) => `<button type="button" class="kind" data-act="addStep" data-kind="${k}" data-after="${after}"><span class="ki">${ICON[k]}</span><strong>${KIND[k].label}</strong><span class="muted">${KIND[k].hint}</span></button>`).join("")}<button type="button" class="btn btn-quiet" data-act="ui" data-key="insertAfter" data-value="null">Cancel</button></div>`
        : `<div class="connector"><button type="button" class="add-here" data-act="ui" data-key="insertAfter" data-value="${after}" data-focus-next='[data-focus="ins-name"]' aria-label="Add a step after ${h(humanize(after))}">＋</button></div>`;
    const cards = d.steps
      .map((s, i) => {
        const bad = issues.filter((x) => x.stepId === s.id && x.severity === "error");
        const isOpen = s.id === open;
        return `<li class="scard ${isOpen ? "open" : ""} ${bad.length ? "bad" : ""}">
          <button type="button" class="scard-head" data-act="toggleStep" data-step="${s.id}" aria-expanded="${isOpen}">
            <span class="sn">${i + 1}</span><span class="si k-${s.kind.replace(".", "-")}" aria-hidden="true">${ICON[s.kind]}</span>
            <span class="st"><span class="sname" ${isOpen ? `tabindex="-1" data-step-title="${s.id}"` : ""}>${h(humanize(s.id))}${d.start === s.id ? ' <span class="first">starts here</span>' : ""}</span><span class="ssent">${sentence(d, s)}</span>
            ${isOpen ? "" : `<span class="thens">${thenLine(d, s)}</span>`}</span>
            ${bad.length ? `<span class="needs">${bad.length} to fix</span>` : ""}<span class="chev" aria-hidden="true">${isOpen ? "−" : "+"}</span>
          </button>
          ${isOpen ? `<div class="scard-body">${stepBody(state, s, bad)}</div>` : ""}
        </li>${s.kind === "end" ? "" : between(s.id)}`;
      })
      .join("");
    return `<div class="sec-head"><h1>Steps</h1><p class="lede">Steps run one at a time. After each one, its result decides where the run goes next. ${K.fbHtml("step")}</p></div>
      <ol class="flow">${cards}</ol>
      <div class="row-actions"><button type="button" class="btn" data-act="ui" data-key="bsec" data-value="safety">Optional: safety & shared rules</button><button type="button" class="btn btn-primary" data-act="ui" data-key="bsec" data-value="finish">Next: review & save →</button></div>`;
  }

  function ruleRows(state, s, list, help) {
    const d = state.draft;
    return list
      .map((o) => {
        const own = s.on?.[o];
        const eff = K.effectiveRule(d, s, o);
        const label = o.startsWith("system.") ? K.SYSTEM_LABELS[o] : o;
        return `<div class="rule ${eff ? "" : "rule-missing"}">
          <span class="rule-if">${help ? "If it reports" : "If"} <code>${h(label)}</code>${K.OUTCOME_HELP[o] ? ` <span class="muted">(${K.OUTCOME_HELP[o]})</span>` : ""}</span>
          <span class="rule-then">then <select data-rule="${s.id}|${o}" data-rule-key="${s.id}|${o}" aria-label="What happens when ${h(label)}">${K.ruleOptions(d, s, o)}</select></span>
          ${s.kind === "agent" && !o.startsWith("system.") ? `<button type="button" class="x" data-act="removeOutcome" data-step="${s.id}" data-outcome="${h(o)}" aria-label="Remove ${h(o)}">✕</button>` : ""}
          ${eff ? (!own ? `<span class="rule-src">${h(eff.label)}</span>` : "") : '<span class="rule-err">Pick where the run should go — or “Pause and wait for me”.</span>'}
          ${own?.retry ? `<span class="rule-src">Try up to <input type="number" min="2" class="tiny" data-bind="step.${s.id}.retry.${o}:max_attempts" value="${own.retry.max_attempts}" aria-label="Total runs"/> times in total, waiting <input type="number" min="0" class="tiny" data-bind="step.${s.id}.retry.${o}:backoff_seconds" value="${own.retry.backoff_seconds}" aria-label="Seconds between"/> seconds between.</span>` : ""}
        </div>`;
      })
      .join("");
  }

  function stepBody(state, s, bad) {
    const d = state.draft;
    let q = "";
    if (s.kind === "agent") {
      const hn = K.DATA.harnesses.find((x) => x.id === s.harness);
      q = `<div class="q"><label>Which agent?</label><div class="agent-pick">${K.DATA.harnesses.map((x) => `<label class="pill-opt ${x.id === s.harness ? "current" : ""}"><input type="radio" name="harness-${s.id}" value="${x.id}" data-bind="step.${s.id}.harness" ${x.id === s.harness ? "checked" : ""}/>${x.label}</label>`).join("")}</div>
        <p class="hint">Runs with unrestricted permissions (${h(hn.permission)}) — it can change any file you can.</p></div>
        <div class="q two"><div><label for="m-${s.id}">Model</label><input id="m-${s.id}" list="ml-${s.id}" data-bind="step.${s.id}.model" value="${h(s.model)}" placeholder="Use the agent’s default"/><datalist id="ml-${s.id}">${hn.models.map((m) => `<option value="${h(m)}"></option>`).join("")}</datalist></div>
          <div><label for="r-${s.id}">Thinking effort</label><select id="r-${s.id}" data-bind="step.${s.id}.reasoning_effort">${["", "low", "medium", "high"].map((r) => `<option value="${r}" ${s.reasoning_effort === r ? "selected" : ""}>${r || "Agent default"}</option>`).join("")}</select></div></div>
        <div class="q"><label for="p-${s.id}">What should it do?</label>${bad.some((b) => b.field === "prompt") ? '<p class="rule-err">Write a prompt so the agent knows what to do.</p>' : ""}<textarea id="p-${s.id}" rows="6" data-bind="step.${s.id}.prompt">${h(s.prompt)}</textarea>
          <p class="hint">Use <code>{{task.text}}</code> for the current task. The agent must finish by reporting one of the results below.</p></div>
        <div class="q"><label>What can it report back, and what happens then?</label>${ruleRows(state, s, s.outcomes, true)}
          ${K.newStepForm("newstep note")}
          <div class="add-outcome"><input data-new-outcome="${s.id}" data-focus="no-${s.id}" placeholder="Another result, e.g. needs_info" aria-label="New result name"/><button type="button" class="btn" data-act="addOutcome" data-step="${s.id}">Add result</button>${K.fbHtml(`outcome:${s.id}`)}</div></div>`;
    } else if (s.kind === "command") {
      q = `<div class="q"><label for="c-${s.id}">Command <span class="muted">(one argument per line — no shell)</span></label><textarea id="c-${s.id}" class="mono" rows="3" data-bind="step.${s.id}.argvText">${h(s.argv.join("\n"))}</textarea></div>
        <div class="q"><label>Then</label>${ruleRows(state, s, K.outcomesOf(s), false)}${K.newStepForm("newstep note")}</div>`;
    } else if (s.kind === "end") {
      q = `<div class="q"><label for="e-${s.id}">Message when the run finishes here</label><input id="e-${s.id}" data-bind="step.${s.id}.label" value="${h(s.label ?? "")}"/></div>`;
    } else {
      q = `<p class="muted">${h(KIND[s.kind].hint)}</p><div class="q"><label>Then</label>${ruleRows(state, s, K.outcomesOf(s), false)}${K.newStepForm("newstep note")}</div>`;
    }
    const more =
      s.kind === "agent" || s.kind === "command"
        ? `<details class="more"><summary>More options</summary>
          <div class="q"><label>If something goes wrong technically (crash, timeout, no report)</label>${ruleRows(state, s, s.kind === "agent" ? ["system.error", "system.timeout", "system.report_error"] : ["system.error", "system.timeout"], false)}</div>
          ${
            s.kind === "agent"
              ? `<div class="q"><label>Conversation</label><select data-bind="step.${s.id}.session"><option value="fresh" ${s.session === "fresh" ? "selected" : ""}>Start a new conversation each time</option><option value="resume" ${s.session === "resume" ? "selected" : ""}>Continue this agent’s last conversation on the task</option></select></div>
          <div class="q"><label>Share reports from earlier steps</label><div class="agent-pick">${d.steps
            .filter((x) => x.kind === "agent" && x.id !== s.id)
            .map(
              (x) =>
                `<label class="pill-opt ${s.include_reports.includes(x.id) ? "current" : ""}"><input type="checkbox" data-bind="step.${s.id}.reports.${x.id}" ${s.include_reports.includes(x.id) ? "checked" : ""}/>${h(humanize(x.id))}</label>`,
            )
            .join("")}</div></div>
          <div class="q two"><div><label>Tags</label><input data-bind="step.${s.id}.tagsText" value="${h(s.tags.join(", "))}" placeholder="e.g. implementation"/></div><div><label>Time limit (seconds)</label><input type="number" data-bind="step.${s.id}.timeout_seconds" value="${s.timeout_seconds ?? ""}" placeholder="None"/></div></div>`
              : ""
          }
        </details>`
        : "";
    return `${q}${more}<div class="card-foot"><span class="muted mono">id: ${h(s.id)}</span><button type="button" class="btn btn-quiet" data-act="deleteStep" data-step="${s.id}">Remove step</button></div>`;
  }

  function safety(state) {
    const d = state.draft;
    return `<h1>Safety & shared rules</h1><p class="lede">You can skip this. These settings protect long runs and save repeating the same choice on many steps.</p>
      <div class="card"><h2>Stop runaway loops</h2><p class="muted">When results can send the run back to an earlier step, set at least one limit. The run pauses when it’s reached.</p>
        <div class="q two"><div><label>Max steps per run</label><input type="number" data-bind="draft.limits.max_step_executions" value="${d.limits.max_step_executions ?? ""}"/></div><div><label>Max hours per run</label><input type="number" value="${(d.limits.max_wall_time_seconds ?? 0) / 3600 || ""}"/></div></div></div>
      <div class="card"><h2>Shared rules</h2>${d.policies
        .map(
          (p) =>
            `<p>For steps tagged <span class="tagchip">${h(p.match.tags?.join(", "))}</span>: ${Object.entries(
              p.on,
            )
              .map(([o, a]) => `if they report <code>${h(o)}</code> → ${h(K.describeAction(d, a))}`)
              .join("; ")}.</p>`,
        )
        .join(
          "",
        )}<p class="muted">A choice made on a step always wins over a shared rule.</p><button type="button" class="btn">Add a shared rule</button></div>
      <div class="card"><h2>When something goes wrong</h2><p>Unless a step says otherwise, technical failures <strong>${h(K.describeAction(d, d.defaults.on["system.error"]))}</strong>.</p>
        <label class="check"><input type="checkbox" ${d.defaults.report_correction_attempts ? "checked" : ""}/> If an agent forgets to report, ask it once more</label></div>`;
  }

  function finish(state, issues) {
    const d = state.draft;
    const errors = issues.filter((i) => i.severity === "error");
    const runMode = state.editorMode === "run";
    const dirty = K.dirty();
    const story = d.steps
      .filter((s) => s.kind !== "end")
      .map(
        (s) =>
          `<li><strong>${h(humanize(s.id))}</strong>: ${sentence(d, s)}<div class="thens">${thenLine(d, s)}</div></li>`,
      )
      .join("");
    const saveBox = runMode
      ? `<div class="q"><label for="rr">Why are you changing it? <span class="muted">(saved in the run’s history)</span></label><input id="rr" data-bind="ui.revisionReason" value="${h(state.ui.revisionReason ?? "")}" placeholder="Clarify number formatting for review"/></div>
        <div class="row-actions"><button type="button" class="btn btn-primary btn-lg" data-act="save">Apply to the run</button>${K.fbHtml("save")}</div><p class="hint">The run stays paused. You resume it yourself.</p>`
      : `<div class="big-actions">
          <div class="ba ${dirty ? "ba-current" : "ba-done"}"><span class="ba-n">1</span><div><strong>Save</strong><p class="muted">${dirty ? "Saves a new revision. Older revisions and runs don’t change." : `Saved as revision ${state.savedRevision}.`}</p>
            <button type="button" class="btn ${dirty ? "btn-primary" : ""}" data-act="save" ${dirty && !K.isBusy("save") ? "" : "disabled"}>Save workflow</button> ${K.fbHtml("save")}</div></div>
          <div class="ba ${dirty ? "" : "ba-current"}"><span class="ba-n">2</span><div><strong>Create a run</strong><p class="muted">Copies the tasks from ${h(d.project.tasksPath || "—")} and prepares a run. Nothing starts until you press Start.</p>
            <button type="button" class="btn ${dirty ? "" : "btn-primary"}" data-act="createRun" ${K.isBusy("create") ? "disabled" : ""}>Create run</button> ${K.fbHtml("create")}</div></div>
        </div>`;
    return `<h1>Review & save</h1>
      ${errors.length ? `<div class="note note-bad"><strong>${errors.length} thing${errors.length > 1 ? "s" : ""} to fix before saving</strong><ul>${errors.map((e) => `<li><button type="button" class="linkish" data-act="fixIssue" data-step="${e.stepId ?? ""}">${h(e.text)}</button></li>`).join("")}</ul></div>` : '<div class="note note-ok">Everything has a next step. Ready to save.</div>'}
      <div class="card">${saveBox}</div>
      <div class="card"><h2>What this workflow will do</h2><ol class="story">${story}</ol></div>
      <details class="more card"><summary>Show YAML</summary><p class="muted">The exact file that gets saved. Advanced users can edit it as text.</p><pre class="yaml">${h(K.toYaml(d))}</pre></details>`;
  }

  /* ---------------- Runs ---------------- */
  function runs(state) {
    const attention = state.runs.filter((r) => ["paused", "interrupted"].includes(r.status));
    const rest = state.runs.filter((r) => !attention.includes(r));
    const card = (
      r,
    ) => `<li class="run-card ${state.ui.highlightRun === r.id ? "new" : ""}"><a class="run-link" href="#/runs/${r.id}"><span class="status s-${K.STATUS[r.status].tone}">${K.STATUS[r.status].label}</span>
      <span class="rc-main"><strong>${h(r.workflow)}</strong><span class="muted">${h(r.note)} · ${r.progress ? `${r.progress[0]} of ${r.progress[1]} tasks · ` : ""}${h(r.updated)}</span></span><span class="go">Open →</span></a></li>`;
    return shell(
      state,
      `<main class="col"><h1>Runs</h1>
      ${attention.length ? `<h2 class="list-h">Needs you (${attention.length})</h2><ul class="run-list">${attention.map(card).join("")}</ul>` : ""}
      <h2 class="list-h">Everything else</h2><ul class="run-list">${rest.map(card).join("")}</ul></main>`,
    );
  }

  /* ---------------- Run details ---------------- */
  function runPage(state) {
    const v = K.runView(state);
    const fresh = state.route.id === "run_4d2b9e07";
    const name = fresh ? state.draft.name : "Implement, review and commit";
    const r = state.run;
    const tasks = K.DATA.tasks.map((t) => {
      const items = v.items.filter((i) => i.task === t.n);
      const done = items.some((i) => i.step === "mark_done") || (t.n === 3 && r.markedComplete);
      const current = !done && items.length > 0;
      return { ...t, items, done, current };
    });
    const openTask = state.ui.openTask ?? (tasks.find((t) => t.current)?.n || null);
    return shell(
      state,
      `<main class="col"><a class="back" href="#/runs">← Runs</a>
      <p class="eyebrow">${h(name)} · <span class="mono">${h(state.route.id)}</span></p>
      <section class="status-card tone-${v.tone}" aria-labelledby="sh"><span class="status s-${v.tone}">${v.label}</span><h1 id="sh">${h(v.headline)}</h1><p>${h(v.detail)}</p>${K.fbHtml("run", "fb fb-banner")}
        ${decisions(state, v)}
      </section>
      <section class="progress"><div class="prog-head"><h2>Tasks</h2><span class="muted">${v.tasksDone} of 5 done · ${v.elapsed}</span></div>
        <ol class="tasks">${tasks.map((t) => taskRow(state, t, openTask, v)).join("")}</ol></section>
      </main>`,
    );
  }

  function reasonInput(op) {
    return `<label class="reason">Reason <span class="muted">(saved in history)</span><input data-bind="ui.reason:${op}" value="${h(K.state.ui[`reason:${op}`] ?? "")}"/></label>`;
  }

  function decisions(state, v) {
    const pick = state.ui.choice;
    const draft = K.DATA.draft;
    const stop =
      state.ui.confirm === "stop"
        ? `<form class="decision-form" data-submit="runControl" data-op="stop"><p><strong>Stop this run?</strong> The running process is ended and cleaned up. File changes already made are kept. A stopped run can’t be resumed.</p>${reasonInput("stop")}<div class="row-actions"><button class="btn btn-danger" type="submit">Stop run</button><button type="button" class="btn btn-quiet" data-act="ui" data-key="confirm" data-value="null">Keep running</button>${K.fbHtml("stop")}</div></form>`
        : `<button type="button" class="linkish danger" data-act="ui" data-key="confirm" data-value="stop">Stop this run…</button>`;
    if (v.status === "ready")
      return `<div class="decision-row"><button type="button" class="btn btn-primary btn-lg" data-act="runControl" data-op="start">Start run</button>${K.fbHtml("start")}</div>
        <p class="hint">Codex, Claude Code and OpenCode steps run with unrestricted permissions in ~/code/tiny-ledger.</p>`;
    if (v.status === "running")
      return `<div class="decision-row"><button type="button" class="btn btn-lg" data-act="runControl" data-op="pause">Pause after this step</button>${K.fbHtml("pause")}</div>${stop}`;
    if (v.status === "pausing") return stop;
    if (v.status === "interrupted")
      return `<div class="note">Recovery decisions are made in the terminal for now:<pre class="cli">wf run recovery ${state.route.id}</pre>It shows what’s known about the step and the choices: retry it, skip it with a result, jump elsewhere, or end the run.</div>`;
    if (v.status !== "paused") return "";
    const cursor = v.cursor;
    const opts = [
      [
        "resume",
        `Resume — ${cursor === "review" && !state.run.manual.length ? "run Review again" : `continue with ${humanize(cursor)}`}`,
        "The step starts again from the beginning.",
      ],
      [
        "skip",
        "Decide Review’s result yourself",
        "Pick approved, revise or blocked. No agent runs.",
      ],
      ["jump", "Go to a different step", "For example, straight to Git add."],
      [
        "complete-task",
        "Mark task 3 done and move on",
        "The remaining steps for this task are skipped.",
      ],
      ["edit", "Change the workflow for this run", "Edit prompts or rules first. Stays paused."],
    ];
    const form =
      pick === "resume"
        ? `${reasonInput("resume")}<button class="btn btn-primary" type="submit">Resume run</button>`
        : pick === "skip"
          ? `<label class="reason">Review’s result<select data-bind="ui.interveneTarget"><option value="">Choose…</option>${["approved", "revise", "blocked"].map((o) => `<option ${state.ui.interveneTarget === o ? "selected" : ""}>${o}</option>`).join("")}</select></label>${state.ui.interveneTarget ? `<p class="hint">Then: ${h(K.describeAction(draft, K.effectiveRule(draft, K.stepById(draft, "review"), state.ui.interveneTarget)?.action))}. The run stays paused until you resume.</p>` : ""}${reasonInput("skip")}<button class="btn btn-primary" type="submit">Record result</button>`
          : pick === "jump"
            ? `<label class="reason">Go to<select data-bind="ui.interveneTarget"><option value="">Choose a step…</option>${draft.steps
                .filter((s) => s.kind !== "task.next")
                .map(
                  (s) =>
                    `<option value="${s.id}" ${state.ui.interveneTarget === s.id ? "selected" : ""}>${h(humanize(s.id))}</option>`,
                )
                .join(
                  "",
                )}</select></label>${reasonInput("jump")}<button class="btn btn-primary" type="submit">Move the run</button>`
            : pick === "complete-task"
              ? `${reasonInput("complete-task")}<button class="btn btn-primary" type="submit">Mark done</button>`
              : pick === "edit"
                ? `<a class="btn btn-primary" href="#/runs/${state.route.id}/edit">Open the workflow editor</a>`
                : "";
    return `<fieldset class="choices"><legend>What should happen next?</legend>${opts
      .map(
        ([
          k,
          l,
          d,
        ]) => `<label class="choice ${pick === k ? "current" : ""}"><input type="radio" name="choice" value="${k}" data-bind="ui.choice" ${pick === k ? "checked" : ""}/><span><strong>${h(l)}</strong><br/><span class="muted">${h(d)}</span></span></label>
        ${pick === k && form ? `<form class="decision-form" data-submit="runControl" data-op="${k}">${form}${K.fbHtml(k)}</form>` : ""}`,
      )
      .join("")}</fieldset>${stop}`;
  }

  function storyLine(state, i) {
    const step = K.stepById(K.DATA.draft, i.step);
    const agent =
      step.kind === "agent" ? K.DATA.harnesses.find((x) => x.id === step.harness).label : null;
    let text;
    if (i.manual) text = `<strong>You</strong>: ${h(i.note)}`;
    else if (i.running)
      text = `<strong>${h(humanize(i.step))}</strong> is running (${agent}, ${i.dur} so far)…`;
    else if (i.interrupted)
      text = `<strong>${h(humanize(i.step))}</strong> was interrupted when the daemon restarted. It didn’t report a result.`;
    else if (i.stopped)
      text = `<strong>${h(humanize(i.step))}</strong> was stopped before it reported.`;
    else if (step.kind === "task.next") return "";
    else if (step.kind === "task.complete") text = "Task marked done.";
    else if (step.kind === "command")
      text = `<strong>${h(humanize(i.step))}</strong> ran <code>${h(step.argv.slice(0, 2).join(" "))}</code> — ${i.outcome === "complete" ? "ok" : "failed"}${i.output ? `<pre class="cli">${h(i.output)}</pre>` : ""}`;
    else
      text = `<strong>${h(humanize(i.step))}</strong> (${agent}) reported <span class="res res-${["blocked", "revise", "needs_debugging"].includes(i.outcome) ? "warn" : "ok"}">${h(i.outcome)}</span>${i.summary ? `<blockquote>${h(i.summary)}${i.issue ? `<br/><span class="muted">Issue: ${h(i.issue)}</span>` : ""}${i.handoff ? `<br/><span class="muted">Handoff: ${h(i.handoff)}</span>` : ""}</blockquote>` : ""}
      <span class="muted">${i.pause ? "→ Paused for you" : `→ ${h(humanize(i.to))}`}${i.ruleSource ? ` (${h(i.ruleSource)})` : ""}</span>`;
    const raw = state.ui.rawItem === i.id;
    return `<li class="story-item ${i.running ? "running" : ""}"><span class="when mono">${i.at}<br/>${i.dur}</span><div>${text}
      ${i.events?.length ? `<button type="button" class="linkish small" data-act="ui" data-key="rawItem" data-value="${raw ? "null" : i.id}" aria-expanded="${raw}">${raw ? "Hide" : "Show"} technical log</button>${raw ? `<pre class="raw">${h(JSON.stringify(i.events, null, 2))}</pre>` : ""}` : ""}</div></li>`;
  }

  function taskRow(state, t, openTask, v) {
    const open = openTask === t.n;
    const mark = t.done ? "✓" : t.current ? "●" : "○";
    const sub = t.done
      ? `Done · ${t.items.filter((i) => i.step === "review").length > 1 ? "revised once · " : ""}committed`
      : t.current
        ? v.status === "running"
          ? "In progress"
          : v.status === "paused"
            ? "Waiting for you"
            : v.label
        : "Waiting";
    return `<li class="task ${t.current ? "current" : ""} ${t.done ? "done" : ""}"><button type="button" class="task-head" data-act="ui" data-key="openTask" data-value="${open ? "null" : t.n}" aria-expanded="${open}" ${t.items.length ? "" : "disabled"}>
      <span class="tm" aria-hidden="true">${mark}</span><span><strong>${h(t.text)}</strong><br/><span class="muted">${sub}</span></span>${t.items.length ? `<span class="chev">${open ? "−" : "+"}</span>` : ""}</button>
      ${open ? `<ol class="story">${t.items.map((i) => storyLine(state, i)).join("")}</ol>` : ""}</li>`;
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
      toggleStep: ({ step }, _el, state) => {
        state.selectedStep = state.selectedStep === step ? null : step;
      },
      fixIssue: ({ step }, _el, state) => {
        state.ui.bsec = step ? "steps" : "basics";
        if (step) state.selectedStep = step;
        state.ui.focusSel = step ? `[data-step-title="${step}"]` : "#bn";
      },
    },
    onRoute(state) {
      if (state.route.view === "editor" && state.editorMode === "run") state.ui.bsec = "steps";
      if (state.route.view === "run" && state.run.variant === "paused") state.ui.openTask = null;
      K.update();
      document.querySelector("main h1")?.setAttribute("tabindex", "-1");
      document.querySelector("main h1")?.focus({ preventScroll: true });
    },
  });
})();
