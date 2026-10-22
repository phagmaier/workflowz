/* PROTOTYPE — Direction C: Visual workflow studio. Sample data only; no daemon calls. */
(() => {
  const K = window.WFZ_KIT;
  const { h, humanize, KIND } = K;
  const ICON = { agent: "✦", command: "$", "task.next": "↳", "task.complete": "✓", end: "■" };
  const NODE_W = 236;
  const NODE_H = 66;
  const GAP = 54;
  const LANE = 16;

  /* ---------- auto layout: list order top-to-bottom; skips on the right, loops on the left ---------- */
  function layout(d) {
    const index = new Map(d.steps.map((s, i) => [s.id, i]));
    const edges = [];
    const ports = new Map();
    for (const [i, s] of d.steps.entries()) {
      const list = [];
      for (const o of K.outcomesOf(s)) {
        const rule = K.effectiveRule(d, s, o);
        if (rule?.action.goto && index.has(rule.action.goto))
          edges.push({
            from: i,
            to: index.get(rule.action.goto),
            outcome: o,
            step: s.id,
            inherited: rule.source !== "step",
          });
        else list.push({ outcome: o, rule });
      }
      ports.set(s.id, list);
    }
    let right = 0;
    let left = 0;
    const straightUsed = new Set();
    for (const e of edges) {
      if (e.to === e.from + 1 && !straightUsed.has(e.from)) {
        e.kind = "straight";
        straightUsed.add(e.from);
      } else if (e.to > e.from) e.kind = "right";
      else e.kind = "left";
    }
    const sorted = (side) =>
      edges
        .filter((e) => e.kind === side)
        .sort((a, b) => Math.abs(a.to - a.from) - Math.abs(b.to - b.from));
    for (const e of sorted("right")) e.lane = right++;
    for (const e of sorted("left")) e.lane = left++;
    const padL = 70 + left * LANE;
    const padR = 70 + right * LANE;
    const width = padL + NODE_W + padR;
    const height = d.steps.length * (NODE_H + GAP) + 20;
    const x0 = padL;
    const y = (i) => 20 + i * (NODE_H + GAP);
    return { edges, ports, width, height, x0, y };
  }

  function edgePath(L, e) {
    const sy = L.y(e.from);
    const ty = L.y(e.to);
    const mid = L.x0 + NODE_W / 2;
    if (e.kind === "straight")
      return {
        d: `M${mid},${sy + NODE_H} L${mid},${ty - 4}`,
        lx: mid + 8,
        ly: sy + NODE_H + GAP / 2 + 4,
      };
    const off = (e.lane % 3) * 8 - 8;
    if (e.kind === "right") {
      const x = L.x0 + NODE_W + 26 + e.lane * LANE;
      const a = sy + NODE_H / 2 + off;
      const b = ty + NODE_H / 2 + off / 2;
      return {
        d: `M${L.x0 + NODE_W},${a} H${x - 6} Q${x},${a} ${x},${a + 6} V${b - 6} Q${x},${b} ${x - 6},${b} H${L.x0 + NODE_W + 4}`,
        lx: L.x0 + NODE_W + 6,
        ly: a - 4,
      };
    }
    const x = L.x0 - 26 - e.lane * LANE;
    const a = sy + NODE_H / 2 + off;
    const b = ty + NODE_H / 2 + off / 2;
    return {
      d: `M${L.x0},${a} H${x + 6} Q${x},${a} ${x},${a - 6} V${b + 6} Q${x},${b} ${x + 6},${b} H${L.x0 - 4}`,
      lx: L.x0 - 6,
      ly: a - 4,
      anchor: "end",
    };
  }

  function canvas(_state, opts) {
    const d = opts.draft;
    const L = layout(d);
    const counts = opts.counts ?? {};
    const edgeSvg = L.edges
      .map((e) => {
        const p = edgePath(L, e);
        const key = `${e.step}|${e.outcome}`;
        const n = opts.edgeCounts?.[key] ?? 0;
        const cls = `edge ${e.inherited ? "inherited" : ""} ${opts.run ? (n ? "walked" : "unwalked") : ""} ${opts.selected === e.step ? "hot" : ""}`;
        return `<path class="${cls}" d="${p.d}" marker-end="url(#arrow)"/><text class="elabel ${opts.selected === e.step ? "hot" : ""}" x="${p.lx}" y="${p.ly}" text-anchor="${p.anchor ?? "start"}">${h(e.outcome)}${n > 1 ? ` ×${n}` : ""}</text>`;
      })
      .join("");
    const nodes = d.steps
      .map((s, i) => {
        const left = L.ports.get(s.id) ?? [];
        const st = opts.nodeState?.(s) ?? "";
        const bad = opts.issues?.some((x) => x.stepId === s.id && x.severity === "error");
        const meta =
          s.kind === "agent"
            ? `${s.harness}${s.model ? ` · ${s.model.split("/").pop()}` : ""}`
            : s.kind === "command"
              ? s.argv.join(" ")
              : KIND[s.kind].short;
        return `<button type="button" class="node k-${s.kind.replace(".", "-")} ${opts.selected === s.id ? "sel" : ""} ${bad ? "bad" : ""} ${st}" style="left:${L.x0}px;top:${L.y(i)}px;width:${NODE_W}px;height:${NODE_H}px" data-act="${opts.run ? "selectNode" : "selectStep"}" data-step="${s.id}" aria-pressed="${opts.selected === s.id}">
          <span class="nk" aria-hidden="true">${ICON[s.kind]}</span><span class="nt"><span class="nn" ${opts.selected === s.id ? `tabindex="-1" data-step-title="${s.id}"` : ""}>${h(humanize(s.id))}</span><span class="nm">${h(meta)}</span></span>
          ${counts[s.id] ? `<span class="ncount" title="Ran ${counts[s.id]} times">×${counts[s.id]}</span>` : ""}
          ${d.start === s.id ? '<span class="nstart">start</span>' : ""}
          ${left.length ? `<span class="nports">${left.map((p) => `<span class="port ${p.rule ? (p.rule.action.pause ? "p-pause" : "p-retry") : "p-missing"}" title="${h(p.outcome)}: ${h(p.rule ? K.describeAction(d, p.rule.action) : "no destination")}">${h(p.outcome)} ${p.rule ? (p.rule.action.pause ? "⏸" : "↻") : "?"}</span>`).join("")}</span>` : ""}
        </button>`;
      })
      .join("");
    return `<div class="canvas" data-scroll="canvas"><div class="stage" style="width:${L.width}px;height:${L.height}px">
      <svg width="${L.width}" height="${L.height}" aria-hidden="true"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrowhead"/></marker></defs>${edgeSvg}</svg>
      ${nodes}</div>
      <div class="legend"><span><i class="lg solid"></i>step rule</span><span><i class="lg dashed"></i>shared rule</span><span>⏸ pause</span><span>↻ retry</span><span class="lg-missing">? needs a destination</span></div></div>`;
  }

  /* ---------- chrome ---------- */
  function shell(state, title, tools, body) {
    const v = state.route.view;
    const wf = ["workflows", "editor", "new"].includes(v);
    const attention = state.runs.filter((r) => ["paused", "interrupted"].includes(r.status)).length;
    return `<div class="app">
      <nav class="rail" aria-label="Main"><span class="mark" aria-hidden="true">W</span>
        <a href="#/workflows" class="${wf ? "current" : ""}" ${wf ? 'aria-current="page"' : ""}><span aria-hidden="true">◇</span>Workflows</a>
        <a href="#/runs" class="${wf ? "" : "current"}" ${wf ? "" : 'aria-current="page"'}><span aria-hidden="true">▷</span>Runs${attention ? `<b class="rbadge">${attention}</b>` : ""}</a>
        <span class="rail-conn ${state.sim.disconnected ? "bad" : ""}" title="${state.sim.disconnected ? "Disconnected" : "Connected to daemon"}">●</span></nav>
      <div class="work">
        <header class="bar"><div class="bar-title">${title}</div><div class="bar-tools">${tools}</div></header>
        ${state.sim.disconnected ? '<div class="conn-banner" role="alert">Disconnected from the daemon — runs continue there. Actions are paused here. <button type="button" data-act="sim" data-key="disconnected">Reconnect</button></div>' : ""}
        ${body}
      </div></div>`;
  }

  function workflows(state) {
    return shell(
      state,
      "<h1>Workflows</h1>",
      `<a class="btn primary" href="#/workflows/new">＋ New workflow</a>`,
      `<main class="gallery">${K.DATA.workflows
        .map((w) => {
          const mini =
            w.id === "implement-review-commit"
              ? K.DATA.draft.steps
              : w.id === "readonly-inspection"
                ? [{ kind: "command" }, { kind: "command" }, { kind: "end" }]
                : [{ kind: "agent" }, { kind: "end" }];
          return `<a class="wf-tile" href="#/workflows/${w.id}"><div class="mini">${mini.map((s) => `<i class="mk k-${s.kind.replace(".", "-")}"></i>`).join("")}</div>
          <strong>${h(w.name)}</strong><span class="dim">${h(w.description)}</span><span class="dim small">rev ${w.revision} · ${w.stepCount} steps · ${h(w.project)}</span></a>`;
        })
        .join("")}
        <a class="wf-tile new" href="#/workflows/new"><span class="plus">＋</span><strong>New workflow</strong><span class="dim">Start blank or from a template</span></a></main>`,
    );
  }

  function newWorkflow(state) {
    const t = state.ui.newTemplate ?? "single";
    return shell(
      state,
      '<a href="#/workflows" class="crumb">Workflows</a><span class="sep">/</span><h1>New workflow</h1>',
      "",
      `<main class="center"><form class="panel form-panel" data-submit="newDraft">
        <label>Name<input data-bind="ui.newName" value="${h(state.ui.newName ?? "")}" placeholder="Fix failing tests"/></label>
        <label>Project folder<input class="mono" data-bind="ui.newRoot" value="${h(state.ui.newRoot ?? "")}" placeholder="/home/you/code/project"/></label>
        <div class="tpls" role="radiogroup" aria-label="Template">${[
          ["single", "Single agent"],
          ["loop", "Task loop"],
          ["commands", "Commands"],
        ]
          .map(
            ([k, l]) =>
              `<label class="tpl ${t === k ? "sel" : ""}"><input type="radio" name="tpl" value="${k}" data-bind="ui.newTemplate" ${t === k ? "checked" : ""}/>${l}<span class="mini">${(k === "loop" ? ["task-next", "agent", "task-complete", "end"] : k === "commands" ? ["command", "end"] : ["agent", "end"]).map((x) => `<i class="mk k-${x}"></i>`).join("")}</span></label>`,
          )
          .join("")}</div>
        <div class="row"><button class="btn primary" type="submit">Open in studio</button>${K.fbHtml("new")}</div></form></main>`,
    );
  }

  /* ---------- editor ---------- */
  function editor(state) {
    const d = state.draft;
    const issues = K.validate(d);
    const errors = issues.filter((i) => i.severity === "error");
    const runMode = state.editorMode === "run";
    const dirty = K.dirty();
    const sel = K.stepById(d, state.selectedStep) ?? d.steps[0];
    const drawer = state.ui.drawer ?? (errors.length ? "problems" : null);
    const title = runMode
      ? `<a href="#/runs" class="crumb">Runs</a><span class="sep">/</span><a href="#/runs/${h(state.route.runEdit)}" class="crumb mono">${h(state.route.runEdit)}</a><span class="sep">/</span><h1>Edit workflow for this run</h1>`
      : `<a href="#/workflows" class="crumb">Workflows</a><span class="sep">/</span><input class="name" data-bind="draft.name" value="${h(d.name)}" aria-label="Workflow name"/><span class="savestate ${dirty ? "dirty" : ""}">${!state.savedRevision ? "● new draft" : dirty ? `● unsaved · rev ${state.savedRevision}` : `✓ rev ${state.savedRevision}`}</span>`;
    const tools = runMode
      ? `<input class="reason-inline" data-bind="ui.revisionReason" value="${h(state.ui.revisionReason ?? "")}" placeholder="Reason for this change" aria-label="Reason for revision"/>${K.fbHtml("save")}<button type="button" class="btn primary" data-act="save">Apply to run</button>`
      : `${K.fbHtml("validate")}<button type="button" class="btn" data-act="validate">Check</button>${K.fbHtml("save")}<button type="button" class="btn ${dirty ? "primary" : ""}" data-act="save" ${dirty ? "" : "disabled"}>Save</button>${K.fbHtml("create")}<button type="button" class="btn ${dirty ? "" : "primary"}" data-act="createRun">Create run</button>`;
    const body = `
      ${runMode ? '<div class="strip warn">Changes apply to this paused run’s future steps only. History, tasks and files are unchanged. The run stays paused.</div>' : ""}
      <div class="studio ${drawer ? "with-drawer" : ""}">
        <section class="canvas-wrap" aria-label="Workflow map">
          <div class="canvas-tools"><button type="button" class="btn sm" data-act="ui" data-key="cadd" data-value="toggle" aria-expanded="${!!state.ui.cadd}">＋ Add step</button>
            ${state.ui.cadd ? `<span class="addmenu"><input data-new-step-name data-focus="cadd-name" placeholder="Name" aria-label="New step name"/>${["agent", "command", "task.next", "task.complete", "end"].map((k) => `<button type="button" class="btn sm" data-act="addStep" data-kind="${k}">${ICON[k]} ${KIND[k].short}</button>`).join("")}</span>` : ""}
            ${K.fbHtml("step")}<span class="dim small">Auto-arranged · order only affects layout</span></div>
          ${canvas(state, { draft: d, selected: sel.id, issues })}
        </section>
        <aside class="inspector" aria-label="Inspector" data-scroll="inspector">${inspector(state, sel, issues)}</aside>
        ${
          drawer
            ? `<section class="drawer" aria-label="${drawer}">${drawerTabs(state, drawer, [
                [
                  "problems",
                  `Problems ${errors.length ? `<b class="cnt">${errors.length}</b>` : ""}`,
                ],
                ["project", "Project"],
                ["rules", "Rules & limits"],
                ["yaml", "YAML"],
              ])}<div class="drawer-body" data-scroll="drawer">${editorDrawer(state, drawer, issues)}</div></section>`
            : `<nav class="drawer-closed">${[
                ["problems", `Problems${errors.length ? ` (${errors.length})` : ""}`],
                ["project", "Project"],
                ["rules", "Rules & limits"],
                ["yaml", "YAML"],
              ]
                .map(
                  ([k, l]) =>
                    `<button type="button" data-act="ui" data-key="drawer" data-value="${k}">${l}</button>`,
                )
                .join("")}</nav>`
        }
      </div>`;
    return shell(state, title, tools, body);
  }

  function drawerTabs(_state, current, tabs) {
    return `<div class="dtabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${current === k}" class="${current === k ? "cur" : ""}" data-act="ui" data-key="drawer" data-value="${k}">${l}</button>`).join("")}<button type="button" class="dclose" data-act="ui" data-key="drawer" data-value="null" aria-label="Close panel">▾</button></div>`;
  }

  function editorDrawer(state, tab, issues) {
    const d = state.draft;
    if (tab === "problems")
      return issues.length
        ? `<ul class="plist">${issues.map((i) => `<li><button type="button" data-act="selectStep" data-step="${i.stepId ?? d.start}" class="${i.severity}">${i.severity === "error" ? "✕" : "⚠"} ${h(i.text)}</button></li>`).join("")}</ul>`
        : '<p class="dim">No problems.</p>';
    if (tab === "yaml") return `<pre class="code">${h(K.toYaml(d))}</pre>`;
    if (tab === "project")
      return `<div class="grid3"><label>Project folder<input class="mono" data-bind="draft.project.root" value="${h(d.project.root)}"/></label><label>Task checklist<input class="mono" data-bind="draft.project.tasksPath" value="${h(d.project.tasksPath)}" placeholder="none"/></label><label>Instruction files (one per line)<textarea rows="2" class="mono" data-bind="draft.project.instructionsText">${h(d.project.instructions.join("\n"))}</textarea></label></div>`;
    return `<div class="grid3"><div><h3>Shared rules</h3>${d.policies
      .map(
        (p) =>
          `<p>Tag <code>${h(p.match.tags?.join(","))}</code>: ${Object.entries(p.on)
            .map(([o, a]) => `${h(o)} → ${h(K.describeAction(d, a))}`)
            .join("; ")}</p>`,
      )
      .join("")}<button type="button" class="btn sm">＋ Shared rule</button></div>
      <div><h3>Defaults</h3><p>Technical failure → ${h(K.describeAction(d, d.defaults.on["system.error"]))}</p><label class="chk"><input type="checkbox" ${d.defaults.report_correction_attempts ? "checked" : ""}/> Ask once more if no report</label></div>
      <div><h3>Limits</h3><label>Max step runs<input type="number" data-bind="draft.limits.max_step_executions" value="${d.limits.max_step_executions ?? ""}"/></label><label>Max hours<input type="number" value="${(d.limits.max_wall_time_seconds ?? 0) / 3600 || ""}"/></label></div></div>`;
  }

  function inspector(state, s, issues) {
    const d = state.draft;
    const tab = state.ui.itab ?? "step";
    const head = `<div class="ins-head"><span class="nk big k-${s.kind.replace(".", "-")}">${ICON[s.kind]}</span><div><h2>${h(humanize(s.id))}</h2><span class="dim small">${KIND[s.kind].label} · <span class="mono">${h(s.id)}</span></span></div>
      <button type="button" class="icon-btn" data-act="deleteStep" data-step="${s.id}" aria-label="Delete step">🗑</button></div>`;
    const tabs = `<div class="itabs" role="tablist">${[
      ["step", "Configure"],
      ["next", "Next steps"],
      ["adv", "Advanced"],
    ]
      .filter(([k]) => s.kind !== "end" || k === "step")
      .map(
        ([k, l]) =>
          `<button type="button" role="tab" aria-selected="${tab === k}" class="${tab === k ? "cur" : ""}" data-act="ui" data-key="itab" data-value="${k}">${l}${k === "next" && issues.some((i) => i.stepId === s.id && i.outcome) ? ' <b class="cnt">!</b>' : ""}</button>`,
      )
      .join("")}</div>`;
    let body = "";
    const t = s.kind === "end" ? "step" : tab;
    if (t === "step") {
      if (s.kind === "agent") {
        const hn = K.DATA.harnesses.find((x) => x.id === s.harness);
        body = `<label>Agent<select data-bind="step.${s.id}.harness">${K.DATA.harnesses.map((x) => `<option value="${x.id}" ${x.id === s.harness ? "selected" : ""}>${x.label}</option>`).join("")}</select></label>
          <label>Model<input list="ml" data-bind="step.${s.id}.model" value="${h(s.model)}" placeholder="agent default"/><datalist id="ml">${hn.models.map((m) => `<option value="${h(m)}"></option>`).join("")}</datalist></label>
          <div class="pair"><label>Effort<select data-bind="step.${s.id}.reasoning_effort">${["", "low", "medium", "high"].map((r) => `<option value="${r}" ${s.reasoning_effort === r ? "selected" : ""}>${r || "default"}</option>`).join("")}</select></label>
          <label>Conversation<select data-bind="step.${s.id}.session"><option value="fresh" ${s.session === "fresh" ? "selected" : ""}>New</option><option value="resume" ${s.session === "resume" ? "selected" : ""}>Continue last</option></select></label></div>
          <p class="warnline">Unrestricted: ${h(hn.permission)}</p>
          <label>Prompt<textarea rows="8" data-bind="step.${s.id}.prompt">${h(s.prompt)}</textarea></label><p class="dim small">Insert <code>{{task.text}}</code> <code>{{reports.implement.summary}}</code></p>`;
      } else if (s.kind === "command")
        body = `<label>Arguments (one per line)<textarea rows="4" class="mono" data-bind="step.${s.id}.argvText">${h(s.argv.join("\n"))}</textarea></label><p class="dim small">No shell. Exit 0 → <code>complete</code>, otherwise <code>failed</code>.</p>`;
      else if (s.kind === "end")
        body = `<label>Finish label<input data-bind="step.${s.id}.label" value="${h(s.label ?? "")}"/></label>`;
      else body = `<p class="dim">${h(KIND[s.kind].hint)}</p>`;
    }
    if (t === "next") {
      const rows = K.outcomesOf(s)
        .map((o) => {
          const eff = K.effectiveRule(d, s, o);
          const own = s.on?.[o];
          return `<div class="nrow ${eff ? "" : "missing"}"><code>${h(o)}</code><select data-rule="${s.id}|${o}" data-rule-key="${s.id}|${o}" aria-label="When ${h(o)}">${K.ruleOptions(d, s, o)}</select>
            ${s.kind === "agent" ? `<button type="button" class="icon-btn" data-act="removeOutcome" data-step="${s.id}" data-outcome="${h(o)}" aria-label="Remove ${h(o)}">✕</button>` : ""}
            ${!eff ? '<span class="nerr">Pick a destination</span>' : !own ? `<span class="dim small">${h(eff.label)}</span>` : ""}
            ${own?.retry ? `<span class="dim small">runs <input type="number" class="tiny" data-bind="step.${s.id}.retry.${o}:max_attempts" value="${own.retry.max_attempts}" aria-label="Total runs"/> wait <input type="number" class="tiny" data-bind="step.${s.id}.retry.${o}:backoff_seconds" value="${own.retry.backoff_seconds}" aria-label="Seconds"/>s</span>` : ""}</div>`;
        })
        .join("");
      body = `<p class="dim small">Each result the step can produce, and where the run goes.</p>${rows}${K.newStepForm("newstep")}
        ${s.kind === "agent" ? `<div class="addo"><input data-new-outcome="${s.id}" data-focus="c-no" placeholder="new result" aria-label="New result name"/><button type="button" class="btn sm" data-act="addOutcome" data-step="${s.id}">Add</button></div>${K.fbHtml(`outcome:${s.id}`)}` : ""}
        ${s.kind === "agent" || s.kind === "command" ? `<h3>Technical failures</h3>${["system.error", "system.timeout"].map((o) => `<div class="nrow"><span class="slabel">${K.SYSTEM_LABELS[o]}</span><select data-rule="${s.id}|${o}" aria-label="${K.SYSTEM_LABELS[o]}">${K.ruleOptions(d, s, o)}</select>${s.on?.[o]?.retry ? `<span class="dim small">runs <input type="number" class="tiny" data-bind="step.${s.id}.retry.${o}:max_attempts" value="${s.on[o].retry.max_attempts}" aria-label="Total runs"/> wait <input type="number" class="tiny" data-bind="step.${s.id}.retry.${o}:backoff_seconds" value="${s.on[o].retry.backoff_seconds}" aria-label="Seconds"/>s</span>` : ""}</div>`).join("")}` : ""}`;
    }
    if (t === "adv") {
      body =
        s.kind === "agent"
          ? `<fieldset><legend>Include reports from</legend>${d.steps
              .filter((x) => x.kind === "agent" && x.id !== s.id)
              .map(
                (x) =>
                  `<label class="chk"><input type="checkbox" data-bind="step.${s.id}.reports.${x.id}" ${s.include_reports.includes(x.id) ? "checked" : ""}/>${h(humanize(x.id))}</label>`,
              )
              .join("")}</fieldset>
            <label>Tags<input data-bind="step.${s.id}.tagsText" value="${h(s.tags.join(", "))}"/></label><label>Timeout (s)<input type="number" data-bind="step.${s.id}.timeout_seconds" value="${s.timeout_seconds ?? ""}"/></label>
            <label>Make this the first step <input type="radio" ${d.start === s.id ? "checked" : ""} data-bind="draft.start" value="${s.id}"/></label>`
          : `<label>Make this the first step <input type="radio" ${d.start === s.id ? "checked" : ""} data-bind="draft.start" value="${s.id}"/></label>`;
    }
    return `${head + tabs}<div class="ins-body">${body}</div>`;
  }

  /* ---------- runs ---------- */
  function runs(state) {
    return shell(
      state,
      "<h1>Runs</h1>",
      "",
      `<main class="runs-main"><table class="grid"><thead><tr><th>Status</th><th>Workflow</th><th>Tasks</th><th>At step</th><th>Updated</th><th>Run</th></tr></thead><tbody>
      ${state.runs.map((r) => `<tr class="${state.ui.highlightRun === r.id ? "new" : ""}"><td><span class="st st-${K.STATUS[r.status].tone}">${K.STATUS[r.status].label}</span></td><td><a href="#/runs/${r.id}">${h(r.workflow)}</a><div class="dim small">${h(r.note)}</div></td><td>${r.progress ? `<span class="meter"><i style="width:${(r.progress[0] / r.progress[1]) * 100}%"></i></span> ${r.progress[0]}/${r.progress[1]}` : "—"}</td><td>${h(humanize(r.step))}</td><td>${h(r.updated)}</td><td class="mono dim">${r.id}</td></tr>`).join("")}
      </tbody></table></main>`,
    );
  }

  /* ---------- run details ---------- */
  function runPage(state) {
    const v = K.runView(state);
    const r = state.run;
    const fresh = state.route.id === "run_4d2b9e07";
    const d = fresh ? state.draft : K.DATA.draft;
    const counts = {};
    const edgeCounts = {};
    for (const i of v.items) {
      if (i.manual) continue;
      counts[i.step] = (counts[i.step] ?? 0) + 1;
      if (i.outcome)
        edgeCounts[`${i.step}|${i.outcome}`] = (edgeCounts[`${i.step}|${i.outcome}`] ?? 0) + 1;
    }
    const selStep = state.ui.runNode ?? v.cursor;
    const attempts = v.items.filter((i) => i.step === selStep && !i.manual);
    const selItem =
      v.items.find((i) => i.id === r.selected && (i.step === selStep || i.manual)) ??
      attempts.at(-1);
    const nodeState = (s) => {
      if (s.id === v.cursor && ["running", "pausing"].includes(v.status)) return "live";
      if (s.id === v.cursor && v.status === "paused") return "waiting";
      if (s.id === v.cursor && ["interrupted", "stopped"].includes(v.status)) return "broken";
      if (s.id === v.cursor && v.status === "ready") return "next";
      return counts[s.id] ? "visited" : "";
    };
    const drawer = state.ui.rdrawer === undefined ? "timeline" : state.ui.rdrawer;
    const title = `<a href="#/runs" class="crumb">Runs</a><span class="sep">/</span><h1>${h(fresh ? state.draft.name : "Implement, review and commit")}</h1><span class="mono dim">${h(state.route.id)}</span>`;
    const body = `<div class="runbar tone-${v.tone}"><span class="st st-${v.tone}">${v.label}</span><div class="rb-text"><strong>${h(v.headline)}</strong><span class="dim">${h(v.detail)}</span></div>
        <div class="rb-stats"><span><b>${v.tasksDone}/5</b> tasks</span><span><b>${v.elapsed}</b> elapsed</span><span>rev <b>${fresh ? state.savedRevision : 12}</b></span></div></div>
      ${K.fbHtml("run", "fb fb-strip")}
      ${popover(state, v)}
      <div class="studio ${drawer ? "with-drawer" : ""}">
        <section class="canvas-wrap" aria-label="Run map">${canvas(state, { draft: d, selected: selStep, run: true, counts, edgeCounts, nodeState })}</section>
        <aside class="inspector" aria-label="Step results" data-scroll="rins">${runInspector(state, d, selStep, attempts, selItem)}</aside>
        ${
          drawer
            ? `<section class="drawer">${drawerTabs(state, drawer, [
                ["timeline", `Timeline <b class="cnt soft">${v.items.length}</b>`],
                ["tasks", "Tasks"],
                ["events", "Raw events"],
              ]).replaceAll(
                'data-key="drawer"',
                'data-key="rdrawer"',
              )}<div class="drawer-body" data-scroll="rdrawer">${runDrawer(state, v, drawer)}</div></section>`
            : `<nav class="drawer-closed">${[
                ["timeline", "Timeline"],
                ["tasks", "Tasks"],
                ["events", "Raw events"],
              ]
                .map(
                  ([k, l]) =>
                    `<button type="button" data-act="ui" data-key="rdrawer" data-value="${k}">${l}</button>`,
                )
                .join("")}</nav>`
        }
      </div>`;
    return shell(state, title, runTools(state, v), body);
  }

  function runTools(state, v) {
    const pop = state.ui.pop;
    const b = (key, label, cls = "") =>
      `<button type="button" class="btn ${cls} ${pop === key ? "on" : ""}" data-act="ui" data-key="pop" data-value="${pop === key ? "null" : key}" aria-expanded="${pop === key}" data-focus-next="[data-focus=pop]">${label}</button>`;
    if (v.status === "ready")
      return `${K.fbHtml("start")}<button type="button" class="btn primary" data-act="runControl" data-op="start">▶ Start</button>`;
    if (v.status === "running")
      return `${K.fbHtml("pause")}<button type="button" class="btn" data-act="runControl" data-op="pause">⏸ Pause after step</button>${b("stop", "■ Stop", "danger-ghost")}`;
    if (v.status === "pausing") return b("stop", "■ Stop", "danger-ghost");
    if (v.status === "paused")
      return `${b("intervene", "Change next step ▾")}<a class="btn" href="#/runs/${state.route.id}/edit">Edit workflow</a>${b("stop", "■ Stop", "danger-ghost")}${b("resume", "▶ Resume…", "primary")}`;
    if (v.status === "interrupted") return b("recover", "Recovery…", "primary");
    return "";
  }

  function popover(state, v) {
    const pop = state.ui.pop;
    if (!pop) return "";
    const reason = (op) =>
      `<input data-bind="ui.reason:${op}" data-focus="pop" value="${h(K.state.ui[`reason:${op}`] ?? "")}" placeholder="Reason (saved in history)" aria-label="Reason"/>`;
    const d = K.DATA.draft;
    let inner = "";
    if (pop === "resume")
      inner = `<p><strong>Resume</strong> starts <b>${h(humanize(v.cursor))}</b> from the beginning.</p><form data-submit="runControl" data-op="resume" class="pform">${reason("resume")}<button class="btn primary" type="submit">Resume</button>${K.fbHtml("resume")}</form>`;
    if (pop === "stop")
      inner = `<p><strong>Stop</strong> ends the current process and waits for it to exit. File changes stay. Can’t be resumed.</p><form data-submit="runControl" data-op="stop" class="pform">${reason("stop")}<button class="btn danger" type="submit">Stop run</button>${K.fbHtml("stop")}</form>`;
    if (pop === "recover")
      inner = `<p><strong>Recovery happens in the terminal for now.</strong> Nothing reruns automatically.</p><pre class="code">wf run recovery ${state.route.id}</pre>`;
    if (pop === "intervene") {
      const mode = state.ui.intervene ?? "jump";
      inner = `<div class="seg">${[
        ["jump", "Jump to step"],
        ["skip", "Set Review’s result"],
        ["complete-task", "Mark task done"],
      ]
        .map(
          ([k, l]) =>
            `<button type="button" class="${mode === k ? "cur" : ""}" data-act="ui" data-key="intervene" data-value="${k}" aria-pressed="${mode === k}">${l}</button>`,
        )
        .join("")}</div>
        <form data-submit="runControl" data-op="${mode}" class="pform">
          ${
            mode === "jump"
              ? `<select data-bind="ui.interveneTarget" aria-label="Target step"><option value="">Target step…</option>${d.steps
                  .filter((s) => s.kind !== "task.next")
                  .map(
                    (s) =>
                      `<option value="${s.id}" ${state.ui.interveneTarget === s.id ? "selected" : ""}>${h(humanize(s.id))}</option>`,
                  )
                  .join("")}</select>`
              : ""
          }
          ${mode === "skip" ? `<select data-bind="ui.interveneTarget" aria-label="Result"><option value="">Result…</option>${["approved", "revise", "blocked"].map((o) => `<option ${state.ui.interveneTarget === o ? "selected" : ""}>${o}</option>`).join("")}</select>` : ""}
          ${reason(mode)}<button class="btn primary" type="submit">Apply — stay paused</button>${K.fbHtml(mode)}</form>
        <p class="dim small">Changes where the run continues. No step runs until you Resume.</p>`;
    }
    return `<div class="popover" role="dialog" aria-label="Run action">${inner}<button type="button" class="pclose" data-act="ui" data-key="pop" data-value="null" aria-label="Close">✕</button></div>`;
  }

  function runInspector(_state, d, stepId, attempts, item) {
    const s = K.stepById(d, stepId);
    const who =
      s.kind === "agent"
        ? `${K.DATA.harnesses.find((x) => x.id === s.harness).label}${s.model ? ` · ${s.model}` : ""}`
        : s.kind === "command"
          ? s.argv.join(" ")
          : KIND[s.kind].label;
    const list = attempts.length
      ? `<div class="attempts">${attempts.map((a, n) => `<button type="button" class="att ${item?.id === a.id ? "cur" : ""}" data-act="selectItem" data-item="${a.id}">#${n + 1} · task ${a.task ?? "–"} · ${a.running ? "running" : a.interrupted ? "interrupted" : a.stopped ? "stopped" : h(a.outcome)}</button>`).join("")}</div>`
      : '<p class="dim">This step hasn’t run in this run.</p>';
    let detail = "";
    if (item) {
      if (item.manual) detail = `<p>${h(item.note)}</p>`;
      else if (item.running)
        detail = `<p class="live-line"><span class="spinner"></span>Running for ${item.dur}…</p>`;
      else if (item.interrupted || item.stopped)
        detail = `<p class="nerr">${item.stopped ? "Stopped before reporting." : "Interrupted by a daemon restart. Process confirmed gone; effects unknown."}</p>`;
      else
        detail = `<dl class="kv"><dt>Result</dt><dd><code>${h(item.outcome)}</code> → ${item.pause ? "paused" : h(humanize(item.to))}</dd>${item.summary ? `<dt>Summary</dt><dd>${h(item.summary)}</dd>` : ""}${item.issue ? `<dt>Issue</dt><dd>${h(item.issue)}</dd>` : ""}${item.handoff ? `<dt>Handoff</dt><dd>${h(item.handoff)}</dd>` : ""}${item.output !== undefined ? `<dt>Output</dt><dd><pre class="code">${h(item.output || "(none)")}</pre></dd>` : ""}<dt>Time</dt><dd>${item.at} · ${item.dur}</dd></dl>`;
      if (item.events?.length)
        detail += `<details><summary>Raw events (${item.events.length})</summary><pre class="code">${h(JSON.stringify(item.events, null, 2))}</pre></details>`;
    }
    return `<div class="ins-head"><span class="nk big k-${s.kind.replace(".", "-")}">${ICON[s.kind]}</span><div><h2>${h(humanize(s.id))}</h2><span class="dim small">${h(who)}</span></div></div>
      <h3>Runs of this step</h3>${list}<div class="ins-body">${detail}</div>`;
  }

  function runDrawer(state, v, tab) {
    if (tab === "events")
      return `<pre class="code">${h(
        JSON.stringify(
          v.items.flatMap((i) => i.events ?? []),
          null,
          1,
        ),
      )}</pre>`;
    if (tab === "tasks")
      return `<ol class="tlist">${K.DATA.tasks.map((t) => `<li class="${t.n <= v.tasksDone ? "done" : t.n === 3 && v.currentTask ? "cur" : ""}">${t.n <= v.tasksDone ? "✓" : t.n === 3 && v.currentTask ? "●" : "○"} ${h(t.text)}</li>`).join("")}</ol>`;
    return `<table class="grid tl"><tbody>${v.items.map((i) => `<tr class="${state.run.selected === i.id ? "cur" : ""}"><td class="mono dim">${i.at}</td><td>${i.task ? `T${i.task}` : ""}</td><td><button type="button" class="linkish" data-act="selectItem" data-item="${i.id}" data-node="${i.step}">${h(i.manual ? "You" : humanize(i.step))}</button></td><td>${i.manual ? h(i.note) : i.running ? "running…" : i.interrupted ? "interrupted" : i.stopped ? "stopped" : `<code>${h(i.outcome)}</code> → ${i.pause ? "paused" : h(humanize(i.to))}`}</td><td class="dim">${i.summary ? h(i.summary) : ""}</td><td class="mono dim">${i.dur}</td></tr>`).join("")}</tbody></table>`;
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
      selectNode: ({ step }, _el, state) => {
        state.ui.runNode = step;
        state.run.selected = null;
      },
    },
    onRoute(state) {
      state.ui.pop = null;
      state.ui.runNode = undefined;
      K.update();
    },
  });
  // Timeline rows also move the map selection to their step.
  document.addEventListener(
    "click",
    (e) => {
      const el = e.target.closest("[data-node]");
      if (el) K.state.ui.runNode = el.dataset.node;
    },
    true,
  );
})();
