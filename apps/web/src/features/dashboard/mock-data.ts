import type { ActivityEvent, DashboardStat, ProjectSummary } from "./types";

// Placeholder data until the server exposes real query APIs (see PRD phase 2+).
const now = Date.now();
const minutesAgo = (minutes: number): string =>
  new Date(now - minutes * 60_000).toISOString();

export const project: ProjectSummary = {
  name: "example-project",
  root: "~/projects/example-project",
  status: "connected",
  lastIndexedAt: minutesAgo(1),
};

export const stats: DashboardStat[] = [
  { id: "files", label: "Files", value: "148", detail: "TypeScript and TSX" },
  { id: "symbols", label: "Symbols", value: "1,203", detail: "Functions, classes, methods" },
  { id: "edges", label: "Relationships", value: "3,871", detail: "Imports and calls" },
  { id: "changes", label: "Changes today", value: "24", detail: "9 created, 13 modified, 2 deleted" },
];

export const activity: ActivityEvent[] = [
  { id: "1", kind: "modified", symbolKind: "function", name: "indexFile", path: "packages/core/src/indexer.ts", occurredAt: minutesAgo(2) },
  { id: "2", kind: "created", symbolKind: "file", name: "watcher.ts", path: "packages/core/src/watcher.ts", occurredAt: minutesAgo(9) },
  { id: "3", kind: "created", symbolKind: "class", name: "ChangeCoordinator", path: "packages/core/src/changes.ts", occurredAt: minutesAgo(14) },
  { id: "4", kind: "modified", symbolKind: "method", name: "GraphStore.upsertNode", path: "packages/db/src/queries.ts", occurredAt: minutesAgo(37) },
  { id: "5", kind: "deleted", symbolKind: "function", name: "legacyParse", path: "packages/parser/src/legacy.ts", occurredAt: minutesAgo(65) },
  { id: "6", kind: "modified", symbolKind: "function", name: "createApp", path: "packages/server/src/app.ts", occurredAt: minutesAgo(130) },
];
