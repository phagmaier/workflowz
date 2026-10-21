import { useRef } from "react";
import type { Session, SessionState } from "../editor-session.ts";

export function YamlTab({ session, state }: { session: Session; state: SessionState }) {
  const pending = state.checking || (!state.checkError && state.checked !== state.generation);
  const editing = state.mode === "text";
  const input = useRef<HTMLTextAreaElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const diagnostics = state.draft?.diagnostics ?? [];
  const jump = (line: number, column: number) => {
    const area = input.current;
    if (!area) return;
    const lines = state.text.split("\n");
    const from =
      lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0) + column - 1;
    area.focus();
    area.setSelectionRange(from, from);
    area.scrollTop = Math.max(0, (line - 3) * 20);
  };
  return (
    <div className="narrow wide">
      <section className="pane">
        <div className="pane-head">
          <h2>YAML</h2>
          <span className="muted small" role="status">
            {pending
              ? "Checking the latest text…"
              : state.checkError
                ? "Not checked"
                : session.valid
                  ? "Checked · valid"
                  : "Needs fixing"}
          </span>
        </div>
        <p className="muted">
          This is exactly what Save or Apply sends. Text editing keeps comments, formatting and
          unfinished edits. Returning to the visual editor requires valid text; later form edits
          regenerate YAML and remove comments.
        </p>
        <div className="row form-actions">
          {editing ? (
            <button
              type="button"
              className="btn"
              disabled={!session.valid}
              onClick={() => {
                session.leaveText();
                queueMicrotask(() => editButton.current?.focus());
              }}
            >
              Return to visual editor
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              ref={editButton}
              disabled={!session.current}
              onClick={() => {
                session.enterText();
                queueMicrotask(() => input.current?.focus());
              }}
            >
              Edit as text
            </button>
          )}
          <button
            type="button"
            className="btn btn-quiet"
            disabled={pending}
            onClick={() => session.recheck()}
          >
            Check again
          </button>
        </div>
        {editing ? (
          <p className="callout">
            Text is the source of truth. Visual editing is paused until you return to it. Your text
            is kept when you leave this page.
          </p>
        ) : null}
        {state.checkError ? (
          <p className="inline-alert" role="alert">
            {state.checkError}
          </p>
        ) : null}
        {editing ? (
          <div className="block">
            <label htmlFor="workflow-yaml">Workflow YAML</label>
            <textarea
              id="workflow-yaml"
              className="yaml yaml-editor"
              ref={input}
              spellCheck={false}
              rows={25}
              value={state.text}
              onChange={(e) => session.editText(e.target.value)}
            />
          </div>
        ) : (
          <pre className="yaml">{state.text}</pre>
        )}
        <section aria-label="YAML checks" aria-busy={pending}>
          <h3 className="h3">Checks{pending ? " (updating)" : ""}</h3>
          {diagnostics.length ? (
            <ul className="problems">
              {diagnostics.map((d) => (
                <li
                  key={`${d.code}:${d.path.join(".")}:${d.location?.line}:${d.location?.column}:${d.message}`}
                >
                  {editing && d.location ? (
                    <button
                      type="button"
                      className={`problem ${d.severity}`}
                      onClick={() => jump(d.location?.line ?? 1, d.location?.column ?? 1)}
                    >
                      {d.severity === "warning" ? "Warning · " : ""}Line {d.location.line}, column{" "}
                      {d.location.column}: {d.message}
                    </button>
                  ) : (
                    <span className={`problem ${d.severity}`}>
                      {d.severity === "warning" ? "Warning · " : ""}
                      {d.location ? `Line ${d.location.line}: ` : ""}
                      {d.message}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">
              {pending ? "Waiting for the newest check…" : "No problems found."}
            </p>
          )}
        </section>
      </section>
    </div>
  );
}
