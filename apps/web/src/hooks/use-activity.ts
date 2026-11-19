import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent } from "@mycel/shared";
import { request, type ConnectionStatus } from "@/lib/api";
import {
  isArchitectureUpdateEvent,
  isChangeEvent,
  isChangesPage,
} from "@/lib/contracts";

export function mergeEvents(
  existing: ChangeEvent[],
  incoming: ChangeEvent[],
): ChangeEvent[] {
  const events = new Map(existing.map((event) => [event.id, event]));
  for (const event of incoming) events.set(event.id, event);
  return [...events.values()].sort((a, b) =>
    BigInt(a.id) > BigInt(b.id) ? -1 : BigInt(a.id) < BigInt(b.id) ? 1 : 0,
  );
}
export function useActivity() {
  const [events, setEvents] = useState<ChangeEvent[]>([]);
  const [connection, setConnection] = useState<ConnectionStatus>("checking");
  const [error, setError] = useState<string>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [architectureRevision, setArchitectureRevision] = useState(0);
  const [page, setPage] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void request(
      `/api/changes?limit=100${page ? `&cursor=${encodeURIComponent(page)}` : ""}`,
      isChangesPage,
      controller.signal,
    ).then(
      (result) => {
        if (controller.signal.aborted) return;
        setEvents((previous) => mergeEvents(previous, result.items));
        setCursor(result.cursor);
        setError(undefined);
        setLoading(false);
      },
      (error) => {
        if (!controller.signal.aborted) {
          setError(String(error));
          setLoading(false);
        }
      },
    );
    return () => controller.abort();
  }, [page]);
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const stream = new EventSource("/api/events");
    let pending: ChangeEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let archTimer: ReturnType<typeof setTimeout> | undefined;
    stream.onopen = () => setConnection("connected");
    stream.onerror = () => setConnection("disconnected");
    stream.addEventListener("change", (message: MessageEvent<string>) => {
      try {
        const event: unknown = JSON.parse(message.data);
        if (!isChangeEvent(event)) throw new Error("Invalid change event");
        pending.push(event);
        timer ??= setTimeout(() => {
          const batch = pending;
          pending = [];
          timer = undefined;
          setEvents((previous) => mergeEvents(previous, batch));
          setRevision((value) => value + 1);
        }, 150);
      } catch {
        setError("A live event was invalid. Reload to resynchronize history.");
      }
    });
    stream.addEventListener("architecture", (message: MessageEvent<string>) => {
      try {
        const event: unknown = JSON.parse(message.data);
        if (!isArchitectureUpdateEvent(event)) return;
        archTimer ??= setTimeout(() => {
          archTimer = undefined;
          setArchitectureRevision((value) => value + 1);
        }, 150);
      } catch {
        // Ignore malformed architecture refresh notices.
      }
    });
    return () => {
      clearTimeout(timer);
      clearTimeout(archTimer);
      stream.close();
    };
  }, []);
  const loadMore = useCallback(() => {
    if (cursor) {
      setLoading(true);
      setPage(cursor);
    }
  }, [cursor]);
  return {
    events,
    connection,
    error,
    loading,
    cursor,
    loadMore,
    revision,
    architectureRevision,
  };
}
