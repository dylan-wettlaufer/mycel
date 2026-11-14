import type { ProjectInfo, ChangeEvent } from "@mycel/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useResource } from "@/hooks/use-resource";
import { isGraphStats } from "@/lib/contracts";
export function DashboardPage({
  project,
  projectError,
  revision = 0,
  events = [],
  onActivity,
}: {
  project: ProjectInfo | null;
  projectError: boolean;
  revision?: number;
  events?: ChangeEvent[];
  onActivity?: () => void;
}) {
  const { data, error } = useResource(
    "/api/graph/stats",
    isGraphStats,
    revision,
  );
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Overview</h2>
        <p className="text-sm text-muted-foreground">
          {project?.root ??
            (projectError
              ? "Repository details unavailable"
              : "Connecting to repository…")}
        </p>
      </div>
      {error && <p role="alert">Statistics unavailable. {error}</p>}
      <section
        aria-label="Project statistics"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {[
          ["Files", data?.fileCount],
          ["Symbols", data?.symbolCount],
          ["Connections", data?.edgeCount],
          ["Diagnostics", data?.diagnosticCount],
        ].map(([label, count]) => (
          <Card key={label}>
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent className="font-mono text-2xl">
              {count ?? "—"}
            </CardContent>
          </Card>
        ))}
      </section>
      <Card>
        <CardHeader>
          <CardTitle>Repository activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {events.length
              ? `${events.length} loaded changes · latest: ${events[0]?.path}`
              : "Changes appear here as files are edited."}
          </p>
          <Button variant="outline" onClick={onActivity}>
            Open activity feed
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
