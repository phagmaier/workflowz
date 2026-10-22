import { useEffect, useState } from "react";
import { describeReadFailure } from "../api.ts";
import { useConnection } from "../connection.tsx";
import type { StepItem } from "../lib/history.ts";
import type { BrowserAttemptOutput } from "../types.ts";

/** Displays only the bounded capture saved by the daemon, never private log files. */
export function AttemptOutput({ runId, item }: { runId: string; item: StepItem }) {
  const { read } = useConnection();
  const [capture, setCapture] = useState<BrowserAttemptOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const { attemptId, state } = item;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a settled state or explicit retry rereads the saved capture.
  useEffect(() => {
    if (!attemptId) return;
    let alive = true;
    setError(null);
    read<BrowserAttemptOutput>({ op: "output", runId, attemptId }).then(
      (result) => {
        if (alive) setCapture(result);
      },
      (failure) => {
        if (alive) setError(describeReadFailure(failure));
      },
    );
    return () => {
      alive = false;
    };
  }, [read, runId, attemptId, state, retry]);

  return (
    <div className="attempt-output">
      <p className="hint">
        Saved output from the latest settled invocation, up to 64 KiB. This view does not stream
        live output.
      </p>
      {attemptId ? (
        <button type="button" className="btn btn-sm" onClick={() => setRetry(retry + 1)}>
          {error ? "Try loading output again" : "Refresh output"}
        </button>
      ) : null}
      {item.exitCode !== null ? (
        <p className="output-exit mono">Exit code {item.exitCode}</p>
      ) : null}
      {!attemptId ? (
        <p className="output-empty">This step has no process output.</p>
      ) : error ? (
        <div className="inline-alert" role="alert">
          <p>Output couldn't be loaded: {error}</p>
        </div>
      ) : !capture ? (
        <p className="muted" role="status">
          <span className="spinner" aria-hidden="true" /> Loading saved output…
        </p>
      ) : capture.stdout === null ? (
        <p className="output-empty">
          {state === "running"
            ? "This attempt is still running. Output appears here after it settles."
            : "No saved output is available for this attempt."}
        </p>
      ) : capture.stdout === "" ? (
        <p className="output-empty">This attempt produced no standard output.</p>
      ) : (
        <>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the bounded scroll region needs keyboard access. */}
          <section aria-label="Standard output" className="output-scroll" tabIndex={0}>
            <pre className="out output-text">{capture.stdout}</pre>
          </section>
          {capture.truncated ? (
            <p className="hint">Showing the first 64 KiB of the saved output.</p>
          ) : item.stdoutTruncated ? (
            <p className="hint">
              Standard output reached its capture limit; additional output was not saved.
            </p>
          ) : null}
        </>
      )}
      {item.stderr ? (
        <>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the bounded scroll region needs keyboard access. */}
          <section aria-label="Error output" className="output-scroll" tabIndex={0}>
            <h3 className="h3">Error output</h3>
            <pre className="out output-text">{item.stderr}</pre>
          </section>
          <p className="hint">
            {item.stderrTruncated
              ? "Saved diagnostic excerpt; additional error output was not saved here."
              : "Saved diagnostic excerpt; it may be shorter than the full output."}
          </p>
        </>
      ) : null}
    </div>
  );
}
