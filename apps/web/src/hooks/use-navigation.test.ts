import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { parseNavigation, useNavigation } from "./use-navigation";
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});
test("navigation roundtrips opaque ids and supports browser history", async () => {
  const { result } = renderHook(useNavigation);
  act(() =>
    result.current.navigate({
      view: "Graph",
      nodeId: "node:src/a & b.ts",
      rootId: "root:one",
      source: true,
    }),
  );
  await waitFor(() =>
    expect(result.current.navigation.nodeId).toBe("node:src/a & b.ts"),
  );
  act(() => result.current.navigate({ view: "Activity", changeId: "123" }));
  await waitFor(() => expect(result.current.navigation.changeId).toBe("123"));
  act(() => window.history.back());
  await waitFor(() => expect(result.current.navigation.source).toBe(true));
  expect(parseNavigation("#view=unknown&change=bad")).toEqual({
    view: "Graph",
  });
});
