import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { activity, project, stats } from "./mock-data";
import type { ChangeKind } from "./types";

const changeStyles: Record<ChangeKind, string> = {
  created: "text-success border-success/40",
  modified: "text-warning border-warning/40",
  deleted: "text-destructive border-destructive/40",
};

export function DashboardPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
        <p className="text-sm text-muted-foreground">
          {project.root} · indexed {formatRelativeTime(project.lastIndexedAt)}
        </p>
      </div>

      <section aria-label="Project statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.id} className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="font-mono text-2xl">{stat.value}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 text-xs text-muted-foreground">
              {stat.detail}
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>Latest structural changes detected in the repository.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {activity.map((event) => (
              <li key={event.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <Badge variant="outline" className={cn("w-20 justify-center", changeStyles[event.kind])}>
                  {event.kind}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    <span className="mr-2 text-xs font-normal text-muted-foreground">
                      {event.symbolKind}
                    </span>
                    {event.name}
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{event.path}</p>
                </div>
                <time
                  dateTime={event.occurredAt}
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  {formatRelativeTime(event.occurredAt)}
                </time>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
