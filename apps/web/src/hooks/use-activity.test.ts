import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ChangeEvent } from "@mycel/shared";
import { mergeEvents, useActivity } from "./use-activity";
const event = (id: string): ChangeEvent => ({
  id,
  projectId: "p",
  entityType: "edge",
  entityId: "ab",
  action: "created",
  path: "a.ts",
  timestamp: "2026-11-13T20:00:00Z",
  beforeRevision: null,
  afterRevision: 1,
  before: null,
  after: {
    id: "ab",
    projectId: "p",
    sourceId: "a",
    targetId: "b",
    kind: "CALLS",
    revision: 1,
  },
});
class Stream {
  static instance: Stream;
  onopen?: () => void;
  onerror?: () => void;
  listeners = new Map<string, (message: { data: string }) => void>();
  close = vi.fn();
  constructor() {
    Stream.instance = this;
  }
  addEventListener(
    name: string,
    listener: (message: { data: string }) => void,
  ) {
    this.listeners.set(name, listener);
  }
  emit(name: string, data: unknown) {
    this.listeners.get(name)?.({ data: JSON.stringify(data) });
  }
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("event merging sorts decimal ids numerically and deduplicates replay", () => {
  expect(
    mergeEvents([event("9"), event("10")], [event("10"), event("11")]).map(
      (item) => item.id,
    ),
  ).toEqual(["11", "10", "9"]);
});
test("SSE and initial history converge and reconnects preserve data", async () => {
  vi.stubGlobal("EventSource", Stream);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ items: [event("9")], cursor: "9" }),
      ),
  );
  const { result, unmount } = renderHook(useActivity);
  await waitFor(() => expect(result.current.events).toHaveLength(1));
  act(() => {
    Stream.instance.onopen?.();
    Stream.instance.emit("change", event("10"));
    Stream.instance.emit("change", event("9"));
  });
  await waitFor(() =>
    expect(result.current.events.map((item) => item.id)).toEqual(["10", "9"]),
  );
  expect(result.current.connection).toBe("connected");
  const prevArchRevision = result.current.architectureRevision;
  act(() => {
    Stream.instance.emit("architecture", {
      projectId: "p",
      revision: 2,
      reason: "file",
      timestamp: "2026-11-18T22:00:00Z",
    });
  });
  await waitFor(() =>
    expect(result.current.architectureRevision).toBeGreaterThan(
      prevArchRevision,
    ),
  );
  act(() => Stream.instance.onerror?.());
  expect(result.current.connection).toBe("disconnected");
  act(() => {
    Stream.instance.onopen?.();
  });
  await waitFor(() =>
    expect(result.current.events.map((item) => item.id)).toEqual(["10", "9"]),
  );
  unmount();
  expect(Stream.instance.close).toHaveBeenCalledOnce();
});
