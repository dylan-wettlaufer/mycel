import { ArrowUpRight } from "lucide-react";
import type { ArchitectureRelationshipChange } from "@mycel/shared";
import { relationshipTitle } from "@/features/activity/relationship-change";
import { navigationHref } from "@/hooks/use-navigation";

export function RelationshipChangeLinks({
  changes,
}: {
  changes: readonly ArchitectureRelationshipChange[];
}) {
  return (
    <ul className="divide-y">
      {changes.map((change) => (
        <li key={change.id}>
          <a
            className="flex items-start justify-between gap-2 rounded-sm py-1.5 text-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            href={navigationHref({
              view: "Activity",
              changeId: change.id,
              relationships: true,
            })}
          >
            <span className="min-w-0 break-words">
              {relationshipTitle(change.relationship, change.action, change)}
              <span className="block text-xs text-muted-foreground">
                {change.relationship.source.path}:
                {change.relationship.startLine}
              </span>
            </span>
            <ArrowUpRight
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
          </a>
        </li>
      ))}
    </ul>
  );
}
