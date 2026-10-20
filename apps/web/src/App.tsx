import { AppShell } from "@/components/layout/app-shell";
import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { project } from "@/features/dashboard/mock-data";
import { useBackendHealth } from "@/hooks/use-backend-health";

export function App() {
  const connection = useBackendHealth();

  return (
    <AppShell projectName={project.name} connection={connection}>
      <DashboardPage />
    </AppShell>
  );
}
