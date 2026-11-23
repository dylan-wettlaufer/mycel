import {
  listChanges,
  getChange,
  getDiff,
  getEventsAfter,
  getAgentHookActivity,
} from "@mycel/db";
import type { SqliteDatabase } from "@mycel/db";
import type {
  ChangesQuery,
  ChangesPage,
  ChangeDiff,
  ChangeEvent,
  AgentProvider,
} from "@mycel/shared";
export interface HistoryQueries {
  listChanges(query?: ChangesQuery): ChangesPage;
  getChange(id: string): ChangeEvent | undefined;
  getDiff(id: string): ChangeDiff | undefined;
  getEventsAfter(id: string, limit?: number): ChangeEvent[];
  getAgentHookActivity?(): ReadonlyMap<AgentProvider, number>;
  onEvent(listener: (event: ChangeEvent) => void): () => void;
  /** Refresh history when a local agent hook updates an existing change. */
  onAttribution?(listener: () => void): () => void;
  /** Aborted before database shutdown so streams can release subscriptions. */
  signal: AbortSignal;
}
export function createHistoryQueries(
  db: SqliteDatabase,
  projectId: string,
  onEvent: HistoryQueries["onEvent"],
  signal: AbortSignal,
): HistoryQueries {
  const attributionListeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  signal.addEventListener(
    "abort",
    () => {
      clearInterval(timer);
      attributionListeners.clear();
    },
    { once: true },
  );
  return {
    listChanges: ({ cursor, limit, ...filter } = {}) =>
      listChanges(db, projectId, cursor, limit, filter),
    getChange: (id) => getChange(db, projectId, id),
    getDiff: (id) => getDiff(db, projectId, id),
    getEventsAfter: (id, limit) => getEventsAfter(db, projectId, id, limit),
    getAgentHookActivity: () => getAgentHookActivity(db, projectId),
    onEvent,
    onAttribution(listener) {
      if (signal.aborted) return () => {};
      attributionListeners.add(listener);
      if (!timer) {
        // SQLite increments this connection's data version on external commits.
        let version: unknown = db.pragma("data_version", { simple: true });
        timer = setInterval(() => {
          const current: unknown = db.pragma("data_version", { simple: true });
          if (current === version) return;
          version = current;
          for (const notify of attributionListeners) notify();
        }, 1_000);
        timer.unref();
      }
      return () => {
        attributionListeners.delete(listener);
        if (attributionListeners.size === 0) {
          clearInterval(timer);
          timer = undefined;
        }
      };
    },
    signal,
  };
}
