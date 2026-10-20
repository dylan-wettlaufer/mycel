export type ChangeKind = "created" | "modified" | "deleted";

export type SymbolKind = "file" | "function" | "class" | "method";

export interface DashboardStat {
  id: string;
  label: string;
  value: string;
  detail: string;
}

export interface ActivityEvent {
  id: string;
  kind: ChangeKind;
  symbolKind: SymbolKind;
  name: string;
  path: string;
  /** ISO 8601 timestamp. */
  occurredAt: string;
}

export interface ProjectSummary {
  name: string;
  root: string;
  status: "connected" | "disconnected";
  lastIndexedAt: string;
}
