/** Hash routes, so browser back/forward works without daemon route changes. */
import { useEffect, useState } from "react";
import type { ExampleId } from "./lib/workflow-edit.ts";

export type EditorTab = "steps" | "project" | "yaml" | "map";
/** Which draft an editor route shows: a new unsaved one, a saved revision, or a paused run's. */
export type EditorTarget =
  | { kind: "draft"; key: string }
  | { kind: "revision"; revisionId: number }
  | { kind: "run"; runId: string };

export type Route =
  | { view: "runs" }
  | { view: "run"; runId: string; tab: "details" | "map" }
  | { view: "workflows" }
  | { view: "new-workflow"; example: ExampleId | null }
  | { view: "editor"; target: EditorTarget; tab: EditorTab }
  | { view: "missing"; hash: string };

const EDITOR_TABS = new Set(["project", "yaml", "map"]);
const EXAMPLES = new Set(["single", "loop", "commands"]);
const tabOf = (part: string | undefined): EditorTab | null =>
  part === undefined ? "steps" : EDITOR_TABS.has(part) ? (part as EditorTab) : null;

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
  const missing = { view: "missing", hash } as const;
  if (!section || (section === "runs" && !id)) return { view: "runs" };
  if (section === "runs" && id) {
    if (tab === "edit") {
      const editorTab = tabOf(extra);
      return editorTab && parts.length <= 4
        ? { view: "editor", target: { kind: "run", runId: id }, tab: editorTab }
        : missing;
    }
    if (!extra && (tab === undefined || tab === "map"))
      return { view: "run", runId: id, tab: tab === "map" ? "map" : "details" };
    return missing;
  }
  if (section !== "workflows") return missing;
  if (!id) return { view: "workflows" };
  if (id === "new")
    return !extra && (tab === undefined || EXAMPLES.has(tab))
      ? { view: "new-workflow", example: (tab as ExampleId | undefined) ?? null }
      : missing;
  if (id === "draft" && tab && /^\d+$/.test(tab)) {
    const editorTab = tabOf(extra);
    return editorTab && parts.length <= 4
      ? { view: "editor", target: { kind: "draft", key: `draft:${tab}` }, tab: editorTab }
      : missing;
  }
  if (/^\d+$/.test(id) && Number(id) > 0) {
    const editorTab = tabOf(tab);
    return editorTab && !extra
      ? { view: "editor", target: { kind: "revision", revisionId: Number(id) }, tab: editorTab }
      : missing;
  }
  return missing;
}

export const runHref = (runId: string, tab: "details" | "map" = "details") =>
  `#/runs/${encodeURIComponent(runId)}${tab === "map" ? "/map" : ""}`;

export function editorHref(target: EditorTarget, tab: EditorTab = "steps"): string {
  const suffix = tab === "steps" ? "" : `/${tab}`;
  if (target.kind === "run") return `#/runs/${encodeURIComponent(target.runId)}/edit${suffix}`;
  if (target.kind === "revision") return `#/workflows/${target.revisionId}${suffix}`;
  return `#/workflows/draft/${target.key.slice("draft:".length)}${suffix}`;
}

/** The session key for an editor route. */
export function sessionKey(target: EditorTarget): string {
  if (target.kind === "run") return `run:${target.runId}`;
  if (target.kind === "revision") return `rev:${target.revisionId}`;
  return target.key;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const changed = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  return route;
}
