import type { Session, SessionState } from "../editor-session.ts";
import type { Problem } from "../lib/workflow-edit.ts";

export function CheckerDock({
  session,
  state,
  problems,
  onFix,
}: {
  session: Session;
  state: SessionState;
  problems: readonly Problem[];
  onFix: (problem: Problem) => void;
}) {
  const pending = state.checking || state.checked !== state.generation;
  const errors = problems.filter((p) => p.severity === "error").length;
  const warnings = problems.length - errors;
  return (
    <aside className="checker-dock" aria-labelledby="checker-title">
      <div className="checker-head">
        <h2 id="checker-title">Checker</h2>
        <span role="status" className={errors && !pending ? "checker-count" : "muted small"}>
          {state.checkError
            ? "Not checked"
            : pending
              ? "Checking latest changes…"
              : errors
                ? `${errors} to fix${warnings ? ` · ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}`
                : warnings
                  ? `${warnings} warning${warnings === 1 ? "" : "s"}`
                  : "All good"}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-quiet"
          disabled={state.checking}
          onClick={() => session.recheck()}
        >
          Check again
        </button>
      </div>
      {state.checkError ? (
        <p className="inline-alert" role="alert">
          {state.checkError} Your edits are kept.
        </p>
      ) : null}
      {problems.length ? (
        <ul
          className={`checker-problems ${pending || state.checkError ? "outdated" : ""}`}
          aria-label="Workflow problems"
        >
          {problems.map((problem) => (
            <li
              className="checker-problem"
              key={`${problem.code}:${problem.stepId}:${problem.field}:${problem.outcome}:${problem.text}`}
            >
              <span className="checker-severity">
                {problem.severity === "error" ? "Problem" : "Warning"}
              </span>
              <span className="checker-message">{problem.text}</span>
              <button
                type="button"
                className="btn btn-sm"
                disabled={pending || !!state.checkError}
                aria-label={`Fix: ${problem.text}`}
                onClick={() => onFix(problem)}
              >
                Fix →
              </button>
            </li>
          ))}
        </ul>
      ) : !pending && !state.checkError ? (
        <p className="checker-ok">
          {state.kind === "run"
            ? "No problems found. Apply keeps this run paused; Resume is a separate action."
            : "No problems found. Save when you're ready; nothing runs until you choose Start."}
        </p>
      ) : null}
      {problems.length && (pending || state.checkError) ? (
        <p className="hint">
          These are from the previous check. Fix actions return after the latest check.
        </p>
      ) : null}
      {problems.length && !state.draft?.document && !pending ? (
        <p className="hint">More checks run once these are fixed.</p>
      ) : null}
    </aside>
  );
}
