import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Explorer } from "./explorer";
const node = {
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
test("search selects a symbol and filters file results", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        projectId: "p",
        revision: 1,
        nodes: [node],
        truncated: true,
      }),
    ),
  );
  const select = vi.fn();
  render(<Explorer onSelect={select} />);
  fireEvent.click(
    await screen.findByRole("button", { name: /save.*function/ }),
  );
  expect(select).toHaveBeenCalledWith(node);
  fireEvent.click(screen.getByRole("button", { name: "files" }));
  expect(screen.getByText("No matching files or symbols.")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "save & more" },
  });
  await vi.waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      "/api/graph/search?q=save%20%26%20more&limit=100",
      expect.any(Object),
    ),
  );
});
test("invalid search responses produce an error state", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ nodes: [{}] })),
  );
  render(<Explorer onSelect={vi.fn()} />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Invalid server response",
  );
});
