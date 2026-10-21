/**
 * Connection, session and mutation state shared by every screen. Reads keep polling while
 * disconnected; mutations are serialized app-wide and never retried.
 */
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
import { ApiError, api } from "./api.ts";
import type { BrowserRequest } from "./types.ts";

export type Phase = "checking" | "pairing" | "ready";
/** Why the pairing screen is showing. */
export type PairingReason = "new" | "expired" | "unreachable" | "logged-out";

interface Ping {
  closing: boolean;
  driveFailure: string | null;
}
interface ConnectionValue {
  phase: Phase;
  pairingReason: PairingReason;
  online: boolean;
  closing: boolean;
  driveFailure: string | null;
  /** Key of the mutation in flight, if any. Inspection stays available meanwhile. */
  busy: string | null;
  read: <T>(request: BrowserRequest) => Promise<T>;
  mutate: <T>(key: string, request: BrowserRequest) => Promise<T>;
  paired: () => void;
  loggedOut: () => void;
  recheck: () => void;
}

const Connection = createContext<ConnectionValue | null>(null);

export function useConnection(): ConnectionValue {
  const value = useContext(Connection);
  if (!value) throw new Error("ConnectionProvider missing");
  return value;
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [pairingReason, setPairingReason] = useState<PairingReason>("new");
  const [online, setOnline] = useState(true);
  const [ping, setPing] = useState<Ping>({ closing: false, driveFailure: null });
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  const wasReady = useRef(false);

  const observe = useCallback((error: unknown) => {
    if (!(error instanceof ApiError)) return;
    if (error.kind === "unreachable") setOnline(false);
    else setOnline(true);
    if (error.kind === "unauthorized") {
      setPairingReason(wasReady.current ? "expired" : "new");
      wasReady.current = false;
      setPhase("pairing");
    }
  }, []);

  const read = useCallback(
    async <T,>(request: BrowserRequest): Promise<T> => {
      try {
        const result = await api<T>(request);
        setOnline(true);
        if (request.op === "session") setPing(result as Ping);
        return result;
      } catch (error) {
        observe(error);
        throw error;
      }
    },
    [observe],
  );

  const mutate = useCallback(
    async <T,>(key: string, request: BrowserRequest): Promise<T> => {
      // One deliberate change at a time; a second click while one settles is refused locally.
      if (busyRef.current) throw new Error("Another action is still finishing.");
      busyRef.current = key;
      setBusy(key);
      try {
        const result = await api<T>(request);
        setOnline(true);
        return result;
      } catch (error) {
        observe(error);
        throw error;
      } finally {
        busyRef.current = null;
        setBusy(null);
      }
    },
    [observe],
  );

  const recheck = useCallback(() => {
    setPhase((current) => (current === "ready" ? current : "checking"));
    api<Ping>({ op: "session" }).then(
      (result) => {
        setPing(result);
        setOnline(true);
        wasReady.current = true;
        setPhase("ready");
      },
      (error: unknown) => {
        if (error instanceof ApiError && error.kind === "unreachable") {
          setOnline(false);
          setPairingReason(wasReady.current ? "expired" : "unreachable");
        } else setPairingReason(wasReady.current ? "expired" : "new");
        wasReady.current = false;
        setPhase("pairing");
      },
    );
  }, []);

  useEffect(recheck, [recheck]);

  const value = useMemo<ConnectionValue>(
    () => ({
      phase,
      pairingReason,
      online,
      closing: ping.closing,
      driveFailure: ping.driveFailure,
      busy,
      read,
      mutate,
      paired: () => {
        wasReady.current = true;
        setOnline(true);
        setPhase("ready");
      },
      loggedOut: () => {
        wasReady.current = false;
        setPairingReason("logged-out");
        setPhase("pairing");
      },
      recheck,
    }),
    [phase, pairingReason, online, ping, busy, read, mutate, recheck],
  );
  return <Connection.Provider value={value}>{children}</Connection.Provider>;
}

/**
 * Calls `tick` now and then `interval` ms after each completion while mounted. Hidden tabs skip
 * ticks; `refresh` runs one immediately. Ticks never overlap.
 */
export function usePolling(tick: () => Promise<void>, interval: number, enabled = true) {
  const tickRef = useRef(tick);
  tickRef.current = tick;
  const intervalRef = useRef(interval);
  intervalRef.current = interval;
  const control = useRef<{ refresh: () => void }>({ refresh: () => {} });

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    let running = false;
    let again = false;
    let alive = true;
    const run = async () => {
      window.clearTimeout(timer);
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        if (!document.hidden) await tickRef.current();
      } catch {
        // Failures are surfaced by the tick's own state; polling continues politely.
      } finally {
        running = false;
        if (alive) {
          if (again) {
            again = false;
            void run();
          } else timer = window.setTimeout(() => void run(), intervalRef.current);
        }
      }
    };
    const visible = () => {
      if (!document.hidden) void run();
    };
    control.current.refresh = () => void run();
    document.addEventListener("visibilitychange", visible);
    void run();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
      control.current.refresh = () => {};
    };
  }, [enabled]);

  return useCallback(() => control.current.refresh(), []);
}
