import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { ConnectionStatus } from "@/lib/api";

import { useProject } from "./use-project";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("clears an earlier project error after reconnecting and loading successfully", async () => {
  const project = {
    name: "recovered-project",
    root: "/projects/recovered-project",
  };
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.json(project)),
  );

  const { result, rerender } = renderHook(
    ({ connection }: { connection: ConnectionStatus }) =>
      useProject(connection),
    { initialProps: { connection: "connected" as ConnectionStatus } },
  );
  await waitFor(() => expect(result.current.error).toBe(true));

  rerender({ connection: "disconnected" });
  rerender({ connection: "connected" });

  await waitFor(() => expect(result.current.project).toEqual(project));
  expect(result.current.error).toBe(false);
});
