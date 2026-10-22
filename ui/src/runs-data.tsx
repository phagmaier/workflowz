/** The run list and saved workflows, shared by the sidebar, the Runs page and Workflows. */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { describeReadFailure } from "./api.ts";
import { useConnection, usePolling } from "./connection.tsx";
import type { RunRow, SavedWorkflow } from "./types.ts";

interface RunsValue {
  runs: RunRow[] | null;
  names: ReadonlyMap<number, string>;
  /** Saved revisions; reread on navigation, since saving happens on other screens. */
  saved: SavedWorkflow[] | null;
  error: string | null;
  refresh: () => void;
}
const Runs = createContext<RunsValue | null>(null);

export function useRuns(): RunsValue {
  const value = useContext(Runs);
  if (!value) throw new Error("RunsProvider missing");
  return value;
}

export function RunsProvider({ children }: { children: ReactNode }) {
  const { read } = useConnection();
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [saved, setSaved] = useState<SavedWorkflow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const known = useRef<ReadonlyMap<number, string> | null>(null);
  const savedRead = useRef(0);

  const loadSaved = useCallback(async () => {
    // Only the newest request may replace the list.
    const request = ++savedRead.current;
    const list = await read<SavedWorkflow[]>({ op: "workflows" });
    if (request !== savedRead.current) return;
    known.current = new Map(list.map((w) => [w.revisionId, w.name]));
    setSaved(list);
  }, [read]);

  const refresh = usePolling(async () => {
    try {
      await read({ op: "session" });
      const list = await read<RunRow[]>({ op: "runs" });
      // Saved revisions are immutable, so the list is reread only when something new appears.
      if (!known.current || list.some((run) => !known.current?.has(run.revisionId)))
        await loadSaved();
      setRuns(list);
      setError(null);
    } catch (failure) {
      setError(describeReadFailure(failure));
      throw failure;
    }
  }, 5000);

  useEffect(() => {
    const changed = () => void loadSaved().catch(() => undefined);
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, [loadSaved]);

  const names = useMemo<ReadonlyMap<number, string>>(
    () => new Map((saved ?? []).map((w) => [w.revisionId, w.name])),
    [saved],
  );
  const value = useMemo(
    () => ({ runs, names, saved, error, refresh }),
    [runs, names, saved, error, refresh],
  );
  return <Runs.Provider value={value}>{children}</Runs.Provider>;
}
