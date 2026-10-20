import { AppShell } from "@/components/layout/app-shell";
import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { project } from "@/features/dashboard/mock-data";

export function App() {
  return (
    <AppShell projectName={project.name} connection={project.status}>
      <DashboardPage />
    </AppShell>
  );
}
