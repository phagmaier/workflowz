import { type FormEvent, useState } from "react";
import { useConnection } from "../connection.tsx";
import { createSession, dropSession, newDraftKey } from "../editor-session.ts";
import { EXAMPLES, type ExampleId, exampleDoc } from "../lib/workflow-edit.ts";
import { editorHref } from "../route.ts";
import { Shell } from "./Shell.tsx";
import { Feedback, type FeedbackState, forgetDraft, useDraft } from "./ui.tsx";

/** Three answers start a draft; everything else is edited afterwards. Nothing is saved here. */
export function NewWorkflowPage({ example }: { example: ExampleId | null }) {
  const { read, online } = useConnection();
  const [name, setName] = useDraft("new:name");
  const [folder, setFolder] = useDraft("new:folder");
  const [chosen, setChosen] = useDraft("new:example", example ?? "single");
  const [tasks, setTasks] = useDraft("new:tasks", "todo.md");
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const pick = (EXAMPLES.some((e) => e.id === chosen) ? chosen : "single") as ExampleId;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fail = (field: string, text: string) => {
      const input = form.elements.namedItem(field);
      if (input instanceof HTMLInputElement) {
        input.setCustomValidity(text);
        input.reportValidity();
        input.addEventListener("input", () => input.setCustomValidity(""), { once: true });
        input.focus();
      }
    };
    const root = folder.trim().replace(/(.)\/+$/, "$1");
    if (!name.trim()) return fail("name", "Give the workflow a name.");
    if (!root.startsWith("/"))
      return fail("folder", "Enter the full path of a folder, starting with /.");
    if (pick === "loop" && !tasks.trim()) return fail("tasks", "Enter the checklist file.");
    const key = newDraftKey();
    const session = createSession(key, "new", root);
    session.read = read;
    setFeedback({ kind: "pending", text: "Creating the draft…" });
    await session.begin(exampleDoc(pick, name.trim(), root, tasks.trim()));
    if (!session.state.draft) {
      dropSession(key);
      setFeedback({
        kind: "error",
        text: `The draft couldn't be checked: ${session.state.checkError ?? "unknown error"} Nothing was created.`,
      });
      return;
    }
    for (const field of ["name", "folder", "example", "tasks"]) forgetDraft(`new:${field}`);
    window.location.hash = editorHref({ kind: "draft", key });
  };

  return (
    <Shell
      section="workflows"
      crumbs={[{ label: "Workflows", href: "#/workflows" }, { label: "New workflow" }]}
      pageKey="new-workflow"
    >
      <div className="narrow">
        <section className="pane">
          <h1 tabIndex={-1}>New workflow</h1>
          <p className="lede">
            Three things to start. You can change all of them in the editor, and nothing is saved
            until you choose Save.
          </p>
          <form onSubmit={(event) => void submit(event)} noValidate>
            <div className="block">
              <label htmlFor="new-name">Name</label>
              <input
                id="new-name"
                name="name"
                value={name}
                maxLength={200}
                placeholder="e.g. Fix failing tests"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="block">
              <label htmlFor="new-folder">Project folder</label>
              <input
                id="new-folder"
                name="folder"
                className="mono"
                value={folder}
                placeholder="/home/you/code/project"
                aria-describedby="new-folder-hint"
                onChange={(event) => setFolder(event.target.value)}
              />
              <span id="new-folder-hint" className="hint">
                The full path of a folder on the daemon's machine. Agents and commands work there,
                and relative paths in the workflow start there.
              </span>
            </div>
            <fieldset className="choices">
              <legend>Start from</legend>
              {EXAMPLES.map((option) => (
                <div key={option.id} className={`choice ${pick === option.id ? "current" : ""}`}>
                  <label>
                    <input
                      type="radio"
                      name="example"
                      value={option.id}
                      checked={pick === option.id}
                      onChange={() => setChosen(option.id)}
                    />
                    <span>
                      <strong>{option.name}</strong>
                      <span className="muted">{option.text}</span>
                    </span>
                  </label>
                  {option.id === "loop" && pick === "loop" ? (
                    <div className="decision-form">
                      <div className="block">
                        <label htmlFor="new-tasks">
                          Task checklist (Markdown file in the project)
                        </label>
                        <input
                          id="new-tasks"
                          name="tasks"
                          className="mono"
                          value={tasks}
                          onChange={(event) => setTasks(event.target.value)}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </fieldset>
            <div className="row form-actions">
              <button
                className="btn btn-primary"
                type="submit"
                disabled={!online || feedback?.kind === "pending"}
              >
                Create draft
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
