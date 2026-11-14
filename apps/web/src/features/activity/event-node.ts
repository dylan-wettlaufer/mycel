import type { ChangeAction, ChangeEvent, GraphNode } from "@mycel/shared";
export function eventNode(event: ChangeEvent): GraphNode | null {
  const entity = event.after ?? event.before;
  return event.entityType === "node" && entity && "path" in entity
    ? entity
    : null;
}
export function recentChanges(
  events: ChangeEvent[],
  now: number,
): Map<string, ChangeAction> {
  const latest = new Map<string, ChangeEvent>();
  for (const event of events) {
    if (event.entityType !== "node") continue;
    const previous = latest.get(event.entityId);
    if (!previous || BigInt(event.id) > BigInt(previous.id))
      latest.set(event.entityId, event);
  }
  return new Map(
    [...latest.values()]
      .filter(
        (event) =>
          event.action !== "deleted" &&
          now - Date.parse(event.timestamp) < 60_000 &&
          now >= Date.parse(event.timestamp),
      )
      .map((event) => [event.entityId, event.action]),
  );
}
