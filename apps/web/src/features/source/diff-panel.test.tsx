import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { DiffPanel } from "./diff-panel";
vi.mock("./monaco-diff", () => ({
  default: ({
    diff,
  }: {
    diff: { beforeContent: string | null; afterContent: string | null };
  }) => <pre data-testid="diff">{JSON.stringify(diff)}</pre>,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test.each([
  [null, "new", "file absent"],
  ["old", null, "file deleted"],
  ["", "updated", "revision 1"],
])(
  "diff preserves recorded sources including absent and empty sides",
  async (beforeContent, afterContent, label) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          changeId: "12",
          path: "a.ts",
          beforeContent,
          afterContent,
          beforeRevision: beforeContent === null ? null : 1,
          afterRevision: afterContent === null ? null : 2,
        }),
      ),
    );
    render(<DiffPanel changeId="12" />);
    const diff = await screen.findByTestId("diff");
    expect(JSON.parse(diff.textContent!).beforeContent).toBe(beforeContent);
    expect(JSON.parse(diff.textContent!).afterContent).toBe(afterContent);
    expect(screen.getByText(new RegExp(label))).toBeTruthy();
  },
);
