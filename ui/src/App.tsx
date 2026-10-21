import { Pairing } from "./components/Pairing.tsx";
import { RunPage } from "./components/RunPage.tsx";
import { RunsPage } from "./components/RunsPage.tsx";
import { Shell } from "./components/Shell.tsx";
import { WorkflowsPage } from "./components/WorkflowsPage.tsx";
import { ConnectionProvider, useConnection } from "./connection.tsx";
import { useRoute } from "./route.ts";
import { RunsProvider } from "./runs-data.tsx";

function Screens() {
  const route = useRoute();
  switch (route.view) {
    case "runs":
      return <RunsPage />;
    case "workflows":
      return <WorkflowsPage />;
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
