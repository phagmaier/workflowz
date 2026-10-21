import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, pair } from "../api.ts";
import { type PairingReason, useConnection } from "../connection.tsx";
import { Feedback, type FeedbackState } from "./ui.tsx";

const INTRO: Record<PairingReason, { title: string; text: string }> = {
  new: {
    title: "Connect this browser",
    text: "Pair this browser with the Workflowz daemon running on this computer.",
  },
  expired: {
    title: "Your browser session ended",
    text: "Sessions last 12 hours and end when the daemon restarts or another browser pairs. Runs kept going in the daemon; pair again to see them.",
  },
  unreachable: {
    title: "Can't reach the daemon",
    text: "Nothing answered at this address. Start the daemon in a terminal, then try again or pair below.",
  },
  "logged-out": {
    title: "This browser is disconnected",
    text: "Runs keep going in the daemon. Pair again whenever you want to follow them here.",
  },
};

export function Pairing() {
  const { pairingReason, paired, recheck } = useConnection();
  const [code, setCode] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const intro = INTRO[pairingReason];

  useEffect(() => {
    document.title = `${intro.title} — Workflowz`;
    input.current?.focus();
  }, [intro.title]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = code.trim().toLowerCase();
    // The code is a credential: it is never kept after an attempt.
    setCode("");
    if (!/^[a-f0-9]{64}$/.test(value)) {
      setFeedback({
        kind: "error",
        text: "That doesn't look like a pairing code. Paste the 64-character code that wf ui printed.",
      });
      input.current?.focus();
      return;
    }
    setSending(true);
    setFeedback({ kind: "pending", text: "Connecting…" });
    try {
      await pair(value);
      paired();
    } catch (error) {
      setFeedback({
        kind: "error",
        text:
          error instanceof ApiError && error.kind === "unreachable"
            ? "Can't reach the daemon. Check that wf daemon start is still running in its terminal."
            : error instanceof ApiError && error.status === 401
              ? "That code didn't work. Each code works once and expires after 5 minutes, and a newer code replaces older ones. Run wf ui again for a fresh code."
              : `Pairing failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
      input.current?.focus();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="pair-page">
      <main className="pair-panel" aria-labelledby="pair-title">
        <p className="brand-small">Workflowz</p>
        <h1 id="pair-title" tabIndex={-1}>
          {intro.title}
        </h1>
        <p className="lede">{intro.text}</p>
        <ol className="pair-steps">
          <li>
            Keep the daemon running in a terminal: <code>wf daemon start</code>
          </li>
          <li>
            In another terminal, run <code>wf ui</code>. It prints a one-use pairing code.
          </li>
          <li>Paste the code below. It expires after 5 minutes.</li>
        </ol>
        <p className="hint">
          Use the same <code>--state-dir</code> for both commands if you normally pass one.
        </p>
        <form onSubmit={(event) => void submit(event)} className="pair-form">
          <label htmlFor="pair-code">Pairing code</label>
          <div className="row">
            <input
              id="pair-code"
              ref={input}
              className="pair-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              aria-describedby="pair-feedback"
            />
            <button className="btn btn-primary" type="submit" disabled={sending}>
              Connect
            </button>
          </div>
          <Feedback value={feedback} id="pair-feedback" />
        </form>
        {pairingReason === "unreachable" ? (
          <button type="button" className="btn btn-quiet" onClick={recheck}>
            Check again
          </button>
        ) : null}
        <p className="hint">Treat the code like a password. Closing this page never stops a run.</p>
      </main>
    </div>
  );
}
