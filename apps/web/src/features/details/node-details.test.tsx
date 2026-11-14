import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { GraphNode } from "@mycel/shared";
import { NodeDetailsPanel } from "./node-details";
const node: GraphNode = {
  id: "one",
  projectId: "p",
  kind: "function",
  name: "save",
  qualifiedName: "save",
  path: "src/save.ts",
  contentHash: "a",
  revision: 1,
  range: {
    start: 0,
    end: 20,
    startLine: 1,
    startColumn: 1,
    endLine: 2,
    endColumn: 1,
  },
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("relationships navigate to nodes and source preserves the symbol range", async () => {
  const caller = { ...node, id: "caller", name: "invoke" };
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({
          projectId: "p",
          revision: 1,
          node,
          callers: { nodes: [caller], truncated: true },
          dependencies: { nodes: [], truncated: false },
          relatedFiles: { nodes: [], truncated: false },
          diagnostics: [],
        }),
      ),
  );
  const select = vi.fn(),
    source = vi.fn(),
    scope = vi.fn();
  render(
    <NodeDetailsPanel
      node={node}
      onSelect={select}
      onSource={source}
      onScope={scope}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /invoke/ }));
  expect(select).toHaveBeenCalledWith(caller);
  fireEvent.click(screen.getByRole("button", { name: "Open source" }));
  expect(source).toHaveBeenCalledWith(node);
  fireEvent.click(screen.getByRole("button", { name: "Focus neighborhood" }));
  expect(scope).toHaveBeenCalledWith(node);
  expect(screen.getByText(/More relationships exist/)).toBeTruthy();
});
