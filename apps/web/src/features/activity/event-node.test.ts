import { expect, test } from "vitest";
import type { ChangeEvent } from "@mycel/shared";
import { recentChanges, eventNode } from "./event-node";
const now = Date.parse("2026-11-13T20:00:00Z");
const event = (
  id: string,
  entityId: string,
  action: ChangeEvent["action"],
  age = 0,
) =>
  ({
    id,
    entityId,
    entityType: "node",
    action,
    timestamp: new Date(now - age).toISOString(),
  }) as ChangeEvent;
test("only the newest nondeleted node change highlights for sixty seconds", () => {
  const events = [
    event("9", "a", "created"),
    event("10", "a", "modified"),
    event("11", "b", "deleted"),
    event("8", "b", "created"),
    event("12", "c", "modified", 60_001),
  ];
  expect([...recentChanges(events, now)]).toEqual([["a", "modified"]]);
  expect([...recentChanges(events, now + 60_001)]).toEqual([]);
});
test("deleted events retain their before node for history", () => {
  const before = { id: "a", path: "a.ts" };
  expect(
    eventNode({
      ...event("1", "a", "deleted"),
      before,
      after: null,
    } as ChangeEvent),
  ).toEqual(before);
});
