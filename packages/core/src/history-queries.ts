import { listChanges, getDiff, getEventsAfter } from "@mycel/db";
import type { SqliteDatabase } from "@mycel/db";
import type { ChangesQuery, ChangesPage, ChangeDiff, ChangeEvent } from "@mycel/shared";
export interface HistoryQueries {
 listChanges(query?: ChangesQuery): ChangesPage;
 getDiff(id: string): ChangeDiff | undefined;
 getEventsAfter(id: string, limit?: number): ChangeEvent[];
 onEvent(listener: (event: ChangeEvent) => void): () => void;
 /** Aborted before database shutdown so streams can release subscriptions. */
 signal: AbortSignal;
}
export function createHistoryQueries(db: SqliteDatabase, projectId: string, onEvent: HistoryQueries["onEvent"], signal: AbortSignal): HistoryQueries {
 return { listChanges: ({ cursor, limit } = {}) => listChanges(db, projectId, cursor, limit), getDiff: (id) => getDiff(db, projectId, id), getEventsAfter: (id, limit) => getEventsAfter(db, projectId, id, limit), onEvent, signal };
}
