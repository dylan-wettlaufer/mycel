import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useBackendHealth } from "./use-backend-health";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

test("checks the same-origin health endpoint before showing connected", async () => {
  fetchMock.mockResolvedValue(Response.json({ status: "ok" }));
  const { result } = renderHook(() => useBackendHealth());
  expect(result.current).toBe("checking");

  await act(async () => {});

  expect(result.current).toBe("connected");
  expect(fetchMock).toHaveBeenCalledWith("/api/health", {
    signal: expect.any(AbortSignal),
    cache: "no-store",
  });
});

test("detects backend loss and reconnects on subsequent polls", async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({ status: "ok" }))
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce(Response.json({ status: "ok" }));
  const { result } = renderHook(() => useBackendHealth());
  await act(async () => {});
  expect(result.current).toBe("connected");

  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(result.current).toBe("disconnected");

  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(result.current).toBe("connected");
});

test.each([
  ["HTTP errors", () => Response.json({ status: "ok" }, { status: 503 })],
  ["unhealthy responses", () => Response.json({ status: "error" })],
  ["missing status", () => Response.json({})],
  ["null responses", () => Response.json(null)],
  ["HTML instead of JSON", () => new Response("<!doctype html>")],
])("treats %s as disconnected", async (_name, response) => {
  fetchMock.mockResolvedValue(response());
  const { result } = renderHook(() => useBackendHealth());
  await act(async () => {});
  expect(result.current).toBe("disconnected");
});

test("times out a stalled request and continues polling", async () => {
  fetchMock.mockImplementationOnce((_input, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
  fetchMock.mockResolvedValueOnce(Response.json({ status: "ok" }));
  const { result } = renderHook(() => useBackendHealth());

  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(result.current).toBe("disconnected");

  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(result.current).toBe("connected");
});

test("aborts pending requests and stops polling when unmounted", async () => {
  let finishRequest: (response: Response) => void = () => {};
  fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finishRequest = resolve; }));
  const { unmount } = renderHook(() => useBackendHealth());
  const signal = fetchMock.mock.calls[0]?.[1]?.signal;

  unmount();
  expect(signal?.aborted).toBe(true);

  await act(async () => { finishRequest(Response.json({ status: "ok" })); });
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
