import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ChangeEvent } from "@mycel/shared";
import { HistoricalSource } from "./historical-source";
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
test("deleted symbols open their recorded before source at the saved line", async () => {
  const event = {
    id: "9",
    entityType: "node",
    action: "deleted",
    path: "deleted.ts",
    before: { path: "deleted.ts", range: { startLine: 7 } },
    after: null,
  } as ChangeEvent;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        changeId: "9",
        path: "deleted.ts",
        beforeContent: "old source",
        afterContent: null,
        beforeRevision: 1,
        afterRevision: null,
      }),
    ),
  );
  render(<HistoricalSource event={event} />);
  const editor = await screen.findByTestId("editor");
  expect(editor.textContent).toBe("old source");
  expect(editor.getAttribute("data-line")).toBe("7");
});
