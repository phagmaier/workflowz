/**
 * Workflow drafts being edited in this tab. The form edits a working model; the daemon's `draft`
 * turns it into YAML and checks it. Only a check of the newest edit makes Save/Create/Apply
 * available, so a delayed answer can never stand in for later typing. Drafts live in memory
 * until saved, so moving between pages and tabs keeps them.
 */
import { useCallback, useSyncExternalStore } from "react";
import { ApiError, describeReadFailure } from "./api.ts";
import type { Doc } from "./lib/workflow-edit.ts";
import type { BrowserDraft, BrowserRequest, BrowserRunEdit } from "./types.ts";

type Read = <T>(request: BrowserRequest) => Promise<T>;
export type SessionKind = "new" | "revision" | "run";

export interface SessionState {
  /** Stable for the life of the draft, even when saving moves it to a new revision. */
  uid: number;
  kind: SessionKind;
  /** Null until the first check returns a readable document. */
  model: Doc | null;
  mode: "visual" | "text";
  originalModel: Doc | null;
  /** YAML for the newest checked edit. This is what Save, Create and Apply send. */
  text: string;
  workflowDir: string;
  draft: BrowserDraft | null;
  generation: number;
  checked: number;
  checking: boolean;
  checkError: string | null;
  /** The revision this draft started from or was last saved as. */
  basedOn: number | null;
  /** YAML of `basedOn`; equal text means nothing is unsaved. */
  savedText: string | null;
  selected: string | null;
  /** Paused-run editing: the `run-edit` snapshot every check and Apply are pinned to. */
  run: BrowserRunEdit | null;
  /** The run moved on since the snapshot; checks and Apply are refused until re-checked. */
  stale: boolean;
  loadError: string | null;
  /** Counts loads of saved text, so forms holding their own text start over after a discard. */
  opened: number;
}

export class Session {
  private listeners = new Set<() => void>();
  private checkSequence = 0;
  private timer: number | undefined;
  read: Read | null = null;
  state: SessionState;

  constructor(
    public key: string,
    kind: SessionKind,
    workflowDir: string,
  ) {
    this.state = {
      uid: ++uids,
      kind,
      model: null,
      mode: "visual",
      originalModel: null,
      text: "",
      workflowDir,
      draft: null,
      generation: 0,
      checked: 0,
      checking: false,
      checkError: null,
      basedOn: null,
      savedText: null,
      selected: null,
      run: null,
      stale: false,
      loadError: null,
      opened: 0,
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  set(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** The newest edit has been checked and nothing is pending. */
  get current() {
    const s = this.state;
    return s.checked === s.generation && !s.checking && !s.checkError && s.draft !== null;
  }
  get valid() {
    return this.current && !!this.state.draft?.valid;
  }
  get dirty() {
    const s = this.state;
    return s.savedText === null || s.generation !== s.checked || s.text !== s.savedText;
  }

  /** First check of loaded text: keeps the exact text so an unchanged save keeps its revision. */
  async open(text: string) {
    window.clearTimeout(this.timer);
    this.set({
      text,
      mode: "visual",
      model: null,
      generation: this.state.generation + 1,
      opened: this.state.opened + 1,
    });
    await this.check(null);
  }

  /** First check of a document built in the browser (a new draft from an example). */
  async begin(model: Doc) {
    this.set({ model, generation: this.state.generation + 1 });
    await this.check(model);
  }

  /** Applies a visual change now and checks it after `delay` ms (typing waits for a pause). */
  edit(change: (model: Doc) => Doc, delay = 0) {
    const model = this.state.model;
    if (!model || this.state.mode === "text") return;
    this.set({ model: change(model), generation: this.state.generation + 1 });
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.check(this.state.model), delay);
  }

  /** Text remains exact, including comments and invalid partial edits. */
  editText(text: string, delay = 400) {
    if (this.state.mode !== "text") return;
    this.set({ text, generation: this.state.generation + 1 });
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.check(null), delay);
  }

  enterText() {
    if (!this.current) return;
    this.set({ mode: "text" });
  }

  leaveText() {
    if (!this.valid || !this.state.draft?.document) return;
    this.set({
      mode: "visual",
      model: this.state.draft.document as Doc,
      opened: this.state.opened + 1,
    });
  }

  /** Checks the newest model again, e.g. after a failed check or a re-pinned run. */
  recheck() {
    window.clearTimeout(this.timer);
    void this.check(
      this.state.mode === "text" || this.state.checked === this.state.generation
        ? null
        : this.state.model,
    );
  }

  private async check(model: Doc | null) {
    const read = this.read;
    if (!read) return;
    const s = this.state;
    const generation = s.generation;
    const sequence = ++this.checkSequence;
    this.set({ checking: true, checkError: null });
    try {
      const draft = await read<BrowserDraft>({
        op: "draft",
        workflowDir: s.workflowDir,
        workflowText: model ? "" : s.text,
        ...(model ? { model } : {}),
        ...(s.run ? { run: { runId: s.run.runId, expectedEventId: s.run.expectedEventId } } : {}),
      });
      if (generation !== this.state.generation || sequence !== this.checkSequence) return;
      this.set({
        draft,
        originalModel:
          this.state.originalModel ??
          (s.savedText === s.text ? (draft.document as Doc | null) : null),
        text: model ? draft.workflowText : this.state.text,
        checked: generation,
        checking: false,
        // A document the daemon couldn't read keeps the form's own model, so typing continues.
        model:
          this.state.mode === "text"
            ? ((draft.document as Doc | null) ?? this.state.model)
            : (this.state.model ?? (draft.document as Doc | null)),
        loadError:
          this.state.model || draft.document
            ? null
            : "This workflow's YAML couldn't be read, so it can't be edited visually.",
      });
    } catch (error) {
      if (generation !== this.state.generation || sequence !== this.checkSequence) return;
      const stale =
        error instanceof ApiError && (error.kind === "stale" || error.kind === "conflict");
      this.set({
        checking: false,
        checkError: stale
          ? "The run changed since this editor opened, so the draft can't be checked against it."
          : describeReadFailure(error),
        stale: this.state.stale || (stale && this.state.run !== null),
      });
    }
  }

  /** Record a save of `text` (the checked YAML that was sent) as revision `revisionId`. */
  saved(revisionId: number, text: string) {
    this.set({ basedOn: revisionId, savedText: text, kind: "revision" });
  }

  dispose() {
    window.clearTimeout(this.timer);
  }
}

let uids = 0;
let drafts = 0;
const sessions = new Map<string, Session>();
const registry = new Set<() => void>();
let registryVersion = 0;
function changed() {
  registryVersion++;
  for (const listener of registry) listener();
}

export const sessionFor = (key: string) => sessions.get(key) ?? null;
export function createSession(key: string, kind: SessionKind, workflowDir: string) {
  sessions.get(key)?.dispose();
  const session = new Session(key, kind, workflowDir);
  sessions.set(key, session);
  changed();
  return session;
}
export function newDraftKey() {
  return `draft:${++drafts}`;
}
/**
 * Moves a saved draft to its revision address. Keep the old key only until navigation settles,
 * so the editor and feedback survive the save without making older revisions permanent aliases.
 */
export function rekey(session: Session, key: string) {
  const replaced = sessions.get(key);
  if (replaced && replaced !== session) {
    for (const [alias, value] of sessions) if (value === replaced) sessions.delete(alias);
    if (replaced.dirty) {
      // Identical saves can reuse a revision whose editor has unrelated unsaved changes.
      replaced.key = newDraftKey();
      sessions.set(replaced.key, replaced);
    } else replaced.dispose();
  }
  session.key = key;
  sessions.set(key, session);
  changed();
}
/** Retire save-time aliases once the router no longer displays them. */
export function releaseSessionAliases(activeKey: string | null) {
  let removed = false;
  for (const [key, session] of sessions) {
    if (key !== session.key && key !== activeKey) {
      sessions.delete(key);
      removed = true;
    }
  }
  if (removed) changed();
}
export function dropSession(key: string) {
  const session = sessions.get(key);
  session?.dispose();
  for (const [alias, value] of sessions) if (value === session) sessions.delete(alias);
  changed();
}
/** Unsaved workflow drafts (not paused-run edits), for the Workflows page. */
export function unsavedDrafts(): Session[] {
  return [...new Set(sessions.values())].filter(
    (s) => s.state.kind !== "run" && (s.state.model || s.state.mode === "text") && s.dirty,
  );
}
export function anyUnsaved() {
  return [...sessions.values()].some((s) => (s.state.model || s.state.mode === "text") && s.dirty);
}

export function useSessionRegistry() {
  return useSyncExternalStore(
    useCallback((listener: () => void) => {
      registry.add(listener);
      return () => registry.delete(listener);
    }, []),
    () => registryVersion,
  );
}

const none = () => () => {};
export function useSession(session: Session | null): SessionState | null {
  return useSyncExternalStore(session?.subscribe ?? none, () => session?.state ?? null);
}

// Reloading or closing the tab loses unsaved drafts; the browser asks first.
window.addEventListener("beforeunload", (event) => {
  if (anyUnsaved()) event.preventDefault();
});
