/// <reference lib="dom" />
/** A draft/decision pins its inspected run and event; polling never rebases user intent. */
import type { BrowserRunEdit } from "../app/browser-service.js";
import type { BrowserRequest } from "../contracts/browser.js";
import type { RunDashboard } from "./dashboard.js";
import type { WorkflowEditor } from "./editor.js";

const node = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const value = (id: string) => node<HTMLInputElement>(id).value.trim();
const checked = (id: string) => node<HTMLInputElement>(id).checked;
export class RunIntervention {
  private revision: BrowserRunEdit | null = null;
  private manual: BrowserRunEdit | null = null;
  private revisionUsed = false;
  private manualUsed = false;
  constructor(
    private readonly api: <T>(request: BrowserRequest) => Promise<T>,
    private readonly dashboard: RunDashboard,
    private readonly editor: WorkflowEditor,
    action: (work: () => Promise<void>) => Promise<void>,
  ) {
    node("run-edit").addEventListener("click", () => void action(() => this.openRevision()));
    node("run-intervene").addEventListener("click", () => void action(() => this.openManual()));
    node("apply-revision").addEventListener("click", () => void action(() => this.applyRevision()));
    node("reinspect-revision").addEventListener("click", () => void action(() => this.reinspect()));
    node("revision-cursor").addEventListener("input", () => {
      node<HTMLInputElement>("revision-confirm").checked = false;
    });
    node("discard-revision").addEventListener(
      "click",
      () =>
        void action(async () => {
          this.revision = null;
          this.editor.bindRun();
          node("revision-edit").hidden = true;
          await this.editor.open(
            "version: 1\nname: New workflow\nproject: {root: .}\nstart: done\nsteps:\n  done: {kind: end}\n",
            this.editor.source.workflowDir,
          );
        }),
    );
    node("close-intervention").addEventListener("click", () => {
      this.manual = null;
      node("intervention").hidden = true;
    });
    node("override-action").addEventListener("change", () => this.targets());
    node("override-target").addEventListener("change", () => this.consequence());
    node("override-form").addEventListener("submit", (event) => {
      event.preventDefault();
      void action(() => this.applyOverride());
    });
  }
  guardPreparation() {
    if (this.revision)
      throw new Error(
        "A run revision draft is open. Explicitly discard it before loading/saving a reusable workflow or creating a run.",
      );
  }
  private matches(target: BrowserRunEdit | null) {
    const status = this.dashboard.inspection;
    return (
      !!target &&
      !!status &&
      status.run.status === "paused" &&
      status.run.runId === target.runId &&
      status.run.revisionId === target.revisionId &&
      status.expectedEventId === target.expectedEventId
    );
  }
  sync() {
    const paused = this.dashboard.inspection?.run.status === "paused";
    node<HTMLButtonElement>("run-edit").disabled = !paused || !!this.revision;
    node<HTMLButtonElement>("run-intervene").disabled = !paused;
    node<HTMLButtonElement>("apply-revision").disabled =
      !this.matches(this.revision) || !this.editor.valid || this.revisionUsed;
    node<HTMLButtonElement>("apply-override").disabled =
      !this.matches(this.manual) || this.manualUsed;
    if (this.manual)
      node("intervention-authorization").textContent = this.manualUsed
        ? "Submitted. Refresh run and explicitly inspect manual intervention again before another action."
        : this.matches(this.manual)
          ? "Pinned inspection is current. Choose a target and submit deliberately."
          : "Inspection unavailable or changed. Decision retained; submission disabled. Select the target run, Refresh run, then Inspect manual intervention to make a fresh decision.";
    if (this.revision)
      node("revision-authorization").textContent = this.revisionUsed
        ? "Submitted. Inspect the run before another action. This draft will not be silently rebound."
        : this.matches(this.revision)
          ? "Pinned inspection is current. Apply deliberately when ready."
          : "Edit authorization unavailable or changed. Draft retained unchanged. Select this run, Refresh run, then explicitly refresh edit authorization. A changed revision requires discarding and reopening.";
  }
  private identity(target: BrowserRunEdit) {
    return `Run ${target.runId} · revision r${target.revisionId} · event ${target.expectedEventId}\nOriginal source directory: ${target.workflowDir}\nCurrent cursor: ${target.cursorStepId} · active task: ${target.activeTaskId ?? "none"}`;
  }
  private async inspect() {
    const status = this.dashboard.inspection;
    if (status?.run.status !== "paused")
      throw new Error("Inspect a paused run first. Interrupted runs require CLI recovery.");
    const target = await this.api<BrowserRunEdit>({
      op: "run-edit",
      runId: status.run.runId,
      expectedEventId: status.expectedEventId,
    });
    if (!this.matches(target))
      throw new Error(
        "Run selection or lifecycle changed during inspection. No draft was replaced; inspect again.",
      );
    return target;
  }
  private async openRevision() {
    this.guardPreparation();
    const target = await this.inspect();
    this.revision = target;
    this.revisionUsed = false;
    node("revision-edit").hidden = false;
    node("revision-target").textContent = this.identity(target);
    node<HTMLInputElement>("revision-reason").value = "";
    node<HTMLInputElement>("revision-cursor").value = "";
    node<HTMLInputElement>("revision-confirm").checked = false;
    this.editor.bindRun({ runId: target.runId, expectedEventId: target.expectedEventId });
    await this.editor.open(target.workflowText, target.workflowDir);
    node("revision-edit").scrollIntoView({ block: "start" });
  }
  private async reinspect() {
    const previous = this.revision;
    if (!previous) return;
    const target = await this.inspect();
    if (target.runId !== previous.runId || target.revisionId !== previous.revisionId)
      throw new Error(
        "Draft belongs to a different run/revision. It was not changed. Discard explicitly to open the selected revision.",
      );
    this.revision = target;
    this.revisionUsed = false;
    node("revision-target").textContent = this.identity(target);
    node<HTMLInputElement>("revision-confirm").checked = false;
    this.editor.bindRun({ runId: target.runId, expectedEventId: target.expectedEventId });
    await this.editor.validate();
  }
  private async applyRevision() {
    const target = this.revision;
    if (!target || !this.matches(target) || this.revisionUsed)
      throw new Error("Refresh and inspect the pinned revision target first.");
    const reason = value("revision-reason");
    if (!reason || !checked("revision-confirm"))
      throw new Error(
        "Enter a nonblank revision reason and confirm the revision/cursor consequences.",
      );
    const source = this.editor.requireValid();
    this.revisionUsed = true;
    await this.dashboard.submit({
      op: "revise",
      runId: target.runId,
      expectedEventId: target.expectedEventId,
      edit: {
        workflowText: source.workflowText,
        reason,
        ...(value("revision-cursor") ? { cursorStepId: value("revision-cursor") } : {}),
      },
    });
  }
  private async openManual() {
    // Explicit reopening inspects again and resets the entire decision, never polling.
    this.manual = await this.inspect();
    this.manualUsed = false;
    node("intervention").hidden = false;
    node("intervention-target").textContent = this.identity(this.manual);
    node<HTMLSelectElement>("override-action").value = "";
    node<HTMLInputElement>("override-reason").value = "";
    this.targets();
    this.sync();
    node("intervention").scrollIntoView({ block: "start" });
  }
  private targets() {
    const target = this.manual;
    const select = node<HTMLSelectElement>("override-target");
    select.replaceChildren(new Option("Choose explicitly…", ""));
    if (target) {
      const action = value("override-action");
      const options =
        action === "jump"
          ? target.steps
              .filter((s) => s.compatible)
              .map((s) => [s.stepId, `${s.stepId} · ${s.kind}`])
          : action === "skip"
            ? (target.steps.find((s) => s.stepId === target.cursorStepId)?.outcomes ?? []).map(
                (o) => [o, o],
              )
            : action === "mark-task-complete"
              ? target.tasks
                  .filter((t) => t.state !== "completed")
                  .map((t) => [t.taskId, `${t.title} · ${t.taskId}`])
              : [];
      for (const [id, label] of options) select.add(new Option(label, id));
    }
    this.consequence();
  }
  private consequence() {
    node<HTMLInputElement>("override-confirm").checked = false;
    const target = this.manual;
    const action = value("override-action");
    const selected = value("override-target");
    node("override-consequence").textContent =
      !target || !selected
        ? "Choose an explicit target to review its consequences."
        : action === "jump"
          ? `Move cursor from ${target.cursorStepId} to ${selected}. No stage executes now. Repeating it may repeat external side effects. Task progress is unchanged.`
          : action === "skip"
            ? `Skip ${target.cursorStepId} with declared outcome ${selected}. Effective route: ${target.steps.find((s) => s.stepId === target.cursorStepId)?.transitions[selected]}. A retry route pauses on manual skip. No process or agent report is created. This does not complete the task.`
            : `Accept task ${selected} complete without implementing it. If active, its active-task pointer is cleared; the cursor stays ${target.cursorStepId}. A compatible jump may be needed before resume.`;
  }
  private async applyOverride() {
    const target = this.manual;
    if (!target || !this.matches(target) || this.manualUsed)
      throw new Error("Inspect manual intervention again before submitting.");
    const action = value("override-action");
    const selected = value("override-target");
    const reason = value("override-reason");
    if (!selected || !reason || !checked("override-confirm"))
      throw new Error("Choose a target, enter a nonblank reason and confirm its consequences.");
    const edit =
      action === "jump"
        ? { action: "jump" as const, stepId: selected, reason }
        : action === "skip"
          ? { action: "skip" as const, outcome: selected, reason }
          : action === "mark-task-complete"
            ? { action: "mark-task-complete" as const, taskId: selected, reason }
            : null;
    if (!edit) throw new Error("Choose a manual action explicitly.");
    this.manualUsed = true;
    await this.dashboard.submit({
      op: "override",
      runId: target.runId,
      expectedEventId: target.expectedEventId,
      edit,
    });
  }
}
