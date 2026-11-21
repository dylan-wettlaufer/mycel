import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "@mycel/shared";
import type { ConnectionStatus } from "@/lib/api";
import { useResource } from "./use-resource";
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
  const [liveEvents, setLiveEvents] = useState<ChangeEvent[]>([]);
  const [connection, setConnection] = useState<ConnectionStatus>("checking");
  const [connections, setConnections] = useState(0);
  const [revision, setRevision] = useState(0);
  const [architectureRevision, setArchitectureRevision] = useState(0);
  const recent = useResource(
    "/api/changes?limit=100",
    isChangesPage,
    connections,
  );
  const events = useMemo(
    () => mergeEvents(recent.data?.items ?? [], liveEvents).slice(0, 150),
    [recent.data, liveEvents],
  );
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const stream = new EventSource("/api/events?tail=1");
    let pending: ChangeEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let archTimer: ReturnType<typeof setTimeout> | undefined;
    stream.onopen = () => {
      setConnection("connected");
      setConnections((value) => value + 1);
      setRevision((value) => value + 1);
    };
    stream.onerror = () => setConnection("disconnected");
    stream.addEventListener("change", (message: MessageEvent<string>) => {
      try {
        const event: unknown = JSON.parse(message.data);
        if (!isChangeEvent(event)) return;
        pending.push(event);
        timer ??= setTimeout(() => {
          const batch = pending;
          pending = [];
          timer = undefined;
          setLiveEvents((previous) =>
            mergeEvents(previous, batch).slice(0, 150),
          );
          setRevision((value) => value + 1);
        }, 150);
      } catch {
        // Ignore malformed notices; query reads remain authoritative.
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
  return {
    events,
    connection,
    revision,
    architectureRevision,
  };
}
