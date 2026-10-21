import { type FormEvent, useEffect, useRef, useState } from "react";
import { useConnection } from "../connection.tsx";
import { createSession, newDraftKey } from "../editor-session.ts";
import { editorHref } from "../route.ts";
import { Shell } from "./Shell.tsx";
import { Feedback, type FeedbackState, useDraft } from "./ui.tsx";

/** Imports text into a new tab-local draft; validation and saving still belong to the daemon. */
export function ImportWorkflowPage() {
  const { read, online } = useConnection();
  const [folder, setFolder] = useDraft("import:folder");
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const mounted = useRef(false);
  const pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const input = form.elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const directory = folder.trim();
    if (!directory.startsWith("/")) {
      setFeedback({ kind: "error", text: "Enter the full workflow folder path, starting with /." });
      (form.elements.namedItem("folder") as HTMLInputElement).focus();
      return;
    }
    if (file.size > 1024 * 1024) {
      setFeedback({ kind: "error", text: "Workflow file exceeds 1 MiB. Choose a smaller file." });
      input.focus();
      return;
    }
    pending.current = true;
    setFeedback({ kind: "pending", text: "Reading and checking the YAML…" });
    let text: string;
    try {
      text = await file.text();
    } catch {
      pending.current = false;
      if (mounted.current)
        setFeedback({ kind: "error", text: "The file couldn't be read. Choose it again." });
      return;
    }
    const key = newDraftKey();
    const session = createSession(key, "new", directory);
    session.read = read;
    await session.open(text);
    // Even unreadable YAML or an unavailable daemon must leave the imported text editable.
    session.set({ mode: "text" });
    pending.current = false;
    if (mounted.current) window.location.hash = editorHref({ kind: "draft", key }, "yaml");
  };
  return (
    <Shell
      section="workflows"
      crumbs={[{ label: "Workflows", href: "#/workflows" }, { label: "Import YAML" }]}
      pageKey="import-workflow"
    >
      <div className="narrow">
        <section className="pane">
          <h1 tabIndex={-1}>Import YAML</h1>
          <p className="lede">
            Open a local workflow file as a new draft. Its text and comments stay intact. Save keeps
            a revision; nothing runs here.
          </p>
          <form onSubmit={(event) => void submit(event)}>
            <div className="block">
              <label htmlFor="import-file">Workflow YAML file</label>
              <input
                id="import-file"
                name="file"
                type="file"
                accept=".yaml,.yml,text/yaml"
                required
              />
            </div>
            <div className="block">
              <label htmlFor="import-folder">Original workflow folder</label>
              <input
                id="import-folder"
                name="folder"
                className="mono"
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
                placeholder="/home/you/project/workflows"
                aria-describedby="import-folder-hint"
                required
              />
              <span id="import-folder-hint" className="hint">
                The full directory path on the daemon's machine. Browsers can't read the original
                location of a selected file. A relative project folder resolves from here;
                instruction and checklist paths resolve from the project folder.
              </span>
            </div>
            <div className="row form-actions">
              <button
                className="btn btn-primary"
                type="submit"
                disabled={!online || feedback?.kind === "pending"}
              >
                Open draft
              </button>
              <a className="btn btn-quiet" href="#/workflows">
                Cancel
              </a>
              <Feedback value={feedback} />
            </div>
          </form>
        </section>
      </div>
    </Shell>
  );
}
