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
  listener?: (message: { data: string }) => void;
  close = vi.fn();
  constructor() {
    Stream.instance = this;
  }
  addEventListener(
    _name: string,
    listener: (message: { data: string }) => void,
  ) {
    this.listener = listener;
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
test("SSE and initial history converge, reconnects preserve data, pagination loads older events", async () => {
  vi.stubGlobal("EventSource", Stream);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(async (url: string) =>
        Response.json(
          url.includes("cursor")
            ? { items: [event("8")], cursor: null }
            : { items: [event("9")], cursor: "9" },
        ),
      ),
  );
  const { result, unmount } = renderHook(useActivity);
  await waitFor(() => expect(result.current.events).toHaveLength(1));
  act(() => {
    Stream.instance.onopen?.();
    Stream.instance.listener?.({ data: JSON.stringify(event("10")) });
    Stream.instance.listener?.({ data: JSON.stringify(event("9")) });
  });
  await waitFor(() =>
    expect(result.current.events.map((item) => item.id)).toEqual(["10", "9"]),
  );
  expect(result.current.connection).toBe("connected");
  act(() => Stream.instance.onerror?.());
  expect(result.current.connection).toBe("disconnected");
  act(() => {
    Stream.instance.onopen?.();
    result.current.loadMore();
  });
  await waitFor(() =>
    expect(result.current.events.map((item) => item.id)).toEqual([
      "10",
      "9",
      "8",
    ]),
  );
  expect(result.current.cursor).toBeNull();
  unmount();
  expect(Stream.instance.close).toHaveBeenCalledOnce();
});
