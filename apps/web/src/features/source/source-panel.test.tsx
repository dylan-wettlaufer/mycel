import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { GraphNode } from "@mycel/shared";
import { SourcePanel } from "./source-panel";
vi.mock("./monaco-view", () => ({
  default: ({
    content,
    range,
  }: {
    content: string;
    range: { startLine: number };
  }) => (
    <pre data-testid="editor" data-line={range.startLine}>
      {content}
    </pre>
  ),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("source viewer loads captured content and passes the selected location to Monaco", async () => {
  const node = { path: "src/a & b.ts", range: { startLine: 12 } } as GraphNode;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        projectId: "p",
        revision: 3,
        path: node.path,
        language: "typescript",
        content: "export function example() {}",
        contentHash: "abc",
      }),
    ),
  );
  render(<SourcePanel node={node} />);
  const editor = await screen.findByTestId("editor");
  expect(editor.getAttribute("data-line")).toBe("12");
  expect(editor.textContent).toContain("example");
  expect(fetch).toHaveBeenCalledWith(
    "/api/files/content?path=src%2Fa%20%26%20b.ts",
    expect.any(Object),
  );
});
