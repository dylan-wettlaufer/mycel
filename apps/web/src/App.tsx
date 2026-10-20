import { AppShell } from "@/components/layout/app-shell";
import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { useBackendHealth } from "@/hooks/use-backend-health";
import { useProject } from "@/hooks/use-project";

export function App() {
  const connection = useBackendHealth();
  const { project, error } = useProject(connection);

  return (
    <AppShell projectName={project?.name ?? "Mycel"} connection={connection}>
      <DashboardPage project={project} projectError={error} />
    </AppShell>
  );
}
