import type { NodeKind } from "@mycel/shared";

export type ChangeKind = "created" | "modified" | "deleted";

export interface DashboardStat {
  id: string;
  label: string;
  value: string;
  detail: string;
}

export interface ActivityEvent {
  id: string;
  kind: ChangeKind;
  symbolKind: NodeKind;
  name: string;
  path: string;
  /** ISO 8601 timestamp. */
  occurredAt: string;
}
