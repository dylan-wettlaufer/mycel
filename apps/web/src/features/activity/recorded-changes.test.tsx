import { cleanup, render, screen, within } from "@testing-library/react";
import type { ChangeEvent, GraphNode } from "@mycel/shared";
import { afterEach, expect, test, vi } from "vitest";
import { RecordedChanges } from "./recorded-changes";
import { formatRecordedTime } from "@/lib/format";

vi.mock("@/features/source/diff-panel", () => ({
  DiffPanel: () => <div>Source diff</div>,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test.each([
  ["claude-code", "Claude Code", "confirmed"],
  ["codex", "Codex", "confirmed"],
  ["cursor", "Cursor", "inferred"],
] as const)(
  "Activity updates the file row and diff for %s",
  async (provider, name, status) => {
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
    const recordedAt = formatRecordedTime(change.timestamp);
    const details = within(screen.getByLabelText("Change details"));
    expect(details.getByText(recordedAt).getAttribute("dateTime")).toBe(
      change.timestamp,
    );
    expect(row.getByTitle(recordedAt)).toBeTruthy();
    expect(details.getByText("Agent attribution unavailable")).toBeTruthy();

    change.attribution = {
      status,
      provider,
      sessionId: "3b27eac3-b3b3-4567-a765-12decf9a7457",
    };
    rerender(<RecordedChanges {...props} revision={3} />);
    const label = `${name} · 3b27eac3 · ${status}`;
    const badge = await row.findByText(label);
    expect(badge.getAttribute("title")).toBe(
      `${name} session ${change.attribution.sessionId}`,
    );
    expect(screen.getAllByText(label)).toHaveLength(2);
    expect(details.queryByText("Agent attribution unavailable")).toBeNull();
  },
);
