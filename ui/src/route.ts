/** Hash routes, so browser back/forward works without daemon route changes. */
import { useEffect, useState } from "react";

export type Route =
  | { view: "runs" }
  | { view: "run"; runId: string; tab: "details" | "map" }
  | { view: "workflows" }
  | { view: "missing"; hash: string };

export function parseRoute(hash: string): Route {
  const parts = hash
    .replace(/^#\/?/, "")
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
  const [section, id, tab, extra] = parts;
  if (!section || (section === "runs" && !id)) return { view: "runs" };
  if (section === "workflows" && !id) return { view: "workflows" };
  if (section === "runs" && id && !extra && (tab === undefined || tab === "map"))
    return { view: "run", runId: id, tab: tab === "map" ? "map" : "details" };
  return { view: "missing", hash };
}

export const runHref = (runId: string, tab: "details" | "map" = "details") =>
  `#/runs/${encodeURIComponent(runId)}${tab === "map" ? "/map" : ""}`;

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const changed = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  return route;
}
