import { cleanup, render, screen, within } from "@testing-library/react";
import type { ChangeEvent, GraphNode } from "@mycel/shared";
import { afterEach, expect, test, vi } from "vitest";
import { RecordedChanges } from "./recorded-changes";

vi.mock("@/features/source/diff-panel", () => ({
  DiffPanel: () => <div>Source diff</div>,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("Activity updates the file row and selected diff when attribution arrives", async () => {
  const file: GraphNode = {
    id: "file",
    projectId: "project",
    kind: "file",
    name: "file.ts",
    qualifiedName: "src/file.ts",
    path: "src/file.ts",
    contentHash: "hash",
    revision: 2,
    range: {
      start: 0,
      end: 10,
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 11,
    },
  };
  const change: ChangeEvent = {
    id: "2",
    projectId: file.projectId,
    timestamp: "2026-11-22T12:00:00Z",
    entityType: "node",
    entityId: file.id,
    action: "modified",
    path: file.path,
    beforeRevision: 1,
    afterRevision: 2,
    before: { ...file, contentHash: "old-hash", revision: 1 },
    after: file,
    attribution: { status: "unknown" },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ items: [change], cursor: null })),
  );
  const props = {
    relationshipView: false,
    showSource: false,
    onSelectEvent: vi.fn(),
    onNode: vi.fn(),
    onSource: vi.fn(),
  };
  const { rerender } = render(<RecordedChanges {...props} revision={2} />);
  const row = within(
    await screen.findByRole("region", { name: "Recorded changes" }),
  );
  expect(row.getByText("Agent unknown")).toBeTruthy();
  expect(screen.getAllByText("Agent unknown")).toHaveLength(2);

  change.attribution = {
    status: "confirmed",
    provider: "claude-code",
    sessionId: "3b27eac3-b3b3-4567-a765-12decf9a7457",
  };
  rerender(<RecordedChanges {...props} revision={3} />);
  const badge = await row.findByText("Claude Code · 3b27eac3 · confirmed");
  expect(badge.getAttribute("title")).toBe(
    `Claude Code session ${change.attribution.sessionId}`,
  );
  expect(
    screen.getAllByText("Claude Code · 3b27eac3 · confirmed"),
  ).toHaveLength(2);
  expect(screen.queryByText("Agent unknown")).toBeNull();
});
