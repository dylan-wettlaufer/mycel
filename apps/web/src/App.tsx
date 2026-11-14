import { useState } from "react";
import type { WorkspaceView } from "@/components/layout/app-shell";
import { AppShell } from "@/components/layout/app-shell";
import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { useBackendHealth } from "@/hooks/use-backend-health";
import { useProject } from "@/hooks/use-project";

export function App() {
  const [view, setView] = useState<WorkspaceView>("Dashboard");
  const connection = useBackendHealth();
  const { project, error } = useProject(connection);

  return (
    <AppShell
      view={view}
      onNavigate={setView}
      projectName={project?.name ?? "Mycel"}
      connection={connection}
    >
      {view === "Dashboard" ? (
        <DashboardPage project={project} projectError={error} />
      ) : (
        <section>
          <h2 className="text-xl font-semibold">{view}</h2>
          <p className="text-muted-foreground">
            Select a file or symbol to explore its connections.
          </p>
        </section>
      )}
    </AppShell>
  );
}
