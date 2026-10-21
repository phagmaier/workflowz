import { useEffect } from "react";
import { EditorPage } from "./components/EditorPage.tsx";
import { ImportWorkflowPage } from "./components/ImportWorkflowPage.tsx";
import { NewWorkflowPage } from "./components/NewWorkflowPage.tsx";
import { Pairing } from "./components/Pairing.tsx";
import { RunPage } from "./components/RunPage.tsx";
import { RunsPage } from "./components/RunsPage.tsx";
import { Shell } from "./components/Shell.tsx";
import { WorkflowsPage } from "./components/WorkflowsPage.tsx";
import { ConnectionProvider, useConnection } from "./connection.tsx";
import { releaseSessionAliases, sessionFor, useSessionRegistry } from "./editor-session.ts";
import { sessionKey, useRoute } from "./route.ts";
import { RunsProvider } from "./runs-data.tsx";

function Screens() {
  const route = useRoute();
  const registryVersion = useSessionRegistry();
  const activeKey = route.view === "editor" ? sessionKey(route.target) : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: late saves can add aliases after navigation has already settled.
  useEffect(() => releaseSessionAliases(activeKey), [activeKey, registryVersion]);
  switch (route.view) {
    case "runs":
      return <RunsPage />;
    case "workflows":
      return <WorkflowsPage />;
    case "new-workflow":
      return <NewWorkflowPage example={route.example} />;
    case "import-workflow":
      return <ImportWorkflowPage />;
    case "editor": {
      // Keyed by draft, so saving a new draft as a revision keeps the page and its feedback.
      const key = sessionKey(route.target);
      return (
        <EditorPage key={sessionFor(key)?.state.uid ?? key} target={route.target} tab={route.tab} />
      );
    }
    case "run":
      // Keyed so another run never shows this run's state, inputs or polling.
      return <RunPage key={route.runId} runId={route.runId} tab={route.tab} />;
    case "missing":
      return (
        <Shell section={null} crumbs={[{ label: "Not found" }]} pageKey={`missing:${route.hash}`}>
          <h1 tabIndex={-1}>This page doesn't exist</h1>
          <p>
            <a href="#/runs">Go to Runs</a>
          </p>
        </Shell>
      );
  }
}

function Gate() {
  const { phase } = useConnection();
  if (phase === "checking")
    return (
      <p className="boot muted" role="status">
        <span className="spinner" aria-hidden="true" /> Connecting to the daemon…
      </p>
    );
  if (phase === "pairing") return <Pairing />;
  return (
    <RunsProvider>
      <Screens />
    </RunsProvider>
  );
}

export function App() {
  return (
    <ConnectionProvider>
      <Gate />
    </ConnectionProvider>
  );
}
