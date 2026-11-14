import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useResource } from "@/hooks/use-resource";
import { isChangesPage } from "@/lib/contracts";
import { DiffPanel } from "@/features/source/diff-panel";
export function RecordedChanges() {
  const { data, error } = useResource("/api/changes?limit=50", isChangesPage);
  const [changeId, setChangeId] = useState<string | null>(null);
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Activity</h2>
      {error ? (
        <p role="alert">History unavailable. {error}</p>
      ) : !data ? (
        <p>Loading history…</p>
      ) : (
        <ul className="divide-y">
          {data.items.map((event) => (
            <li key={event.id}>
              <Button
                variant="ghost"
                className="h-auto w-full justify-start py-3"
                onClick={() => setChangeId(event.id)}
              >
                <Badge variant="outline">{event.action}</Badge>
                <span className="truncate">{event.path}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  #{event.id}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {changeId && <DiffPanel changeId={changeId} />}
    </section>
  );
}
