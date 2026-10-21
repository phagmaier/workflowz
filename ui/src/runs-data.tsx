/** The run list and saved workflow names, shared by the sidebar count and the Runs page. */
import { createContext, type ReactNode, useContext, useMemo, useRef, useState } from "react";
import { describeReadFailure } from "./api.ts";
import { useConnection, usePolling } from "./connection.tsx";
import type { RunRow, SavedWorkflow } from "./types.ts";

interface RunsValue {
  runs: RunRow[] | null;
  names: ReadonlyMap<number, string>;
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
  const [names, setNames] = useState<ReadonlyMap<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const known = useRef<ReadonlyMap<number, string>>(names);

  const refresh = usePolling(async () => {
    try {
      await read({ op: "session" });
      const list = await read<RunRow[]>({ op: "runs" });
      // Saved revisions are immutable, so names are fetched only for revisions not seen yet.
      if (list.some((run) => !known.current.has(run.revisionId))) {
        const saved = await read<SavedWorkflow[]>({ op: "workflows" });
        known.current = new Map(saved.map((w) => [w.revisionId, w.name]));
        setNames(known.current);
      }
      setRuns(list);
      setError(null);
    } catch (failure) {
      setError(describeReadFailure(failure));
      throw failure;
    }
  }, 5000);

  const value = useMemo(() => ({ runs, names, error, refresh }), [runs, names, error, refresh]);
  return <Runs.Provider value={value}>{children}</Runs.Provider>;
}
