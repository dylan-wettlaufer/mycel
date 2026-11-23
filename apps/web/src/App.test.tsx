import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { App } from "./App";

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("the workspace shows backend health and the repository selected by the CLI", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    return url === "/api/health"
      ? Response.json({ status: "ok" })
      : Response.json({
          name: "selected-repository",
          root: "/projects/selected-repository",
        });
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  expect(screen.getByRole("status").textContent).toBe("Checking…");

  await screen.findByText("Connected");
  expect(screen.getByRole("status").textContent).toBe("Connected");
  expect(fetchMock).toHaveBeenCalledWith("/api/health", expect.any(Object));
  await screen.findByRole("heading", { name: "selected-repository" });
  expect(
    screen
      .getByRole("heading", { name: "selected-repository" })
      .getAttribute("title"),
  ).toBe("/projects/selected-repository");
  expect(fetchMock).toHaveBeenCalledWith("/api/project", expect.any(Object));
});

test("invalid repository metadata is reported without showing a fake project", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockImplementation(async (url) => {
      return url === "/api/health"
        ? Response.json({ status: "ok" })
        : Response.json({ name: "invalid" });
    }),
  );
  render(<App />);
  await screen.findByText("Repository details unavailable");
  expect(screen.getByRole("heading", { name: "Mycel" })).toBeTruthy();
});

test("the workspace opens on Graph and offers Activity and Explorer", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ status: "ok" })),
  );
  render(<App />);
  const nav = within(screen.getByRole("navigation", { name: "Primary" }));
  expect(
    nav.getAllByRole("button").map((button) => button.textContent),
  ).toEqual(["Graph", "Activity", "Explorer"]);
  expect(
    await screen.findByRole("heading", { name: "Architecture map" }),
  ).toBeTruthy();
  expect(
    nav.getByRole("button", { name: "Graph" }).getAttribute("aria-current"),
  ).toBe("page");
  fireEvent.click(nav.getByRole("button", { name: "Explorer" }));
  expect(await screen.findByRole("heading", { name: "Explorer" })).toBeTruthy();
});

const emptyArchitecture = {
  projectId: "project",
  revision: 1,
  source: "folder-fallback",
  parts: [],
  connections: [],
  relationshipChanges: [],
  changes: {
    available: false,
    requestedWindow: "branch",
    resolvedWindow: "branch",
    branch: null,
    baseRef: null,
    baseCommit: null,
    addedFiles: [],
    modifiedFiles: [],
    deletedFiles: [],
    uncommittedFiles: [],
  },
  unassignedFiles: [],
  tieWarnings: [],
};

test("a failed map load can be retried and then shows an actionable empty state", async () => {
  const map = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockImplementation(async () => Response.json(emptyArchitecture));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (String(url).startsWith("/api/architecture?")) return map();
      return Response.json({ status: "ok", name: "repository", root: "/repo" });
    }),
  );

  render(<App />);
  expect(await screen.findByText("Architecture map unavailable")).toBeTruthy();
  expect(screen.queryByText("No indexed source files")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("No indexed source files")).toBeTruthy();
  expect(screen.queryByText("Architecture map unavailable")).toBeNull();
  expect(map).toHaveBeenCalledTimes(2);
  expect(fetch).not.toHaveBeenCalledWith(
    "/api/graph/repository",
    expect.anything(),
  );
});

test("a stale component link offers a path back to the repository map", async () => {
  window.history.replaceState(null, "", "/#view=Graph&component=old");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (String(url).includes("component=old"))
        return new Response(null, { status: 404 });
      if (String(url).startsWith("/api/architecture?"))
        return Response.json(emptyArchitecture);
      return Response.json({ status: "ok", name: "repository", root: "/repo" });
    }),
  );

  render(<App />);
  expect(await screen.findByText("Component map unavailable")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Back to architecture map" }),
  );
  expect(await screen.findByText("No indexed source files")).toBeTruthy();
  expect(window.location.hash).toBe("#view=Graph");
});

test("a failed live refresh keeps the last successful architecture snapshot", async () => {
  class MockEventSource extends EventTarget {
    static instance: MockEventSource;
    onopen: (() => void) | null = null;
    constructor() {
      super();
      MockEventSource.instance = this;
    }
    close() {}
  }
  vi.stubGlobal("EventSource", MockEventSource);
  const map = vi
    .fn()
    .mockResolvedValueOnce(Response.json(emptyArchitecture))
    .mockResolvedValueOnce(new Response(null, { status: 500 }))
    .mockResolvedValueOnce(
      Response.json({ ...emptyArchitecture, revision: 2 }),
    );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (String(url).startsWith("/api/architecture?")) return map();
      return Response.json({ status: "ok", name: "repository", root: "/repo" });
    }),
  );

  render(<App />);
  await screen.findByText("No indexed source files");
  act(() => MockEventSource.instance.onopen?.());
  await screen.findByText("Could not refresh the map");
  expect(screen.getByText(/Showing indexed revision 1/)).toBeTruthy();
  expect(screen.getByText("No indexed source files")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.queryByText("Could not refresh the map")).toBeNull(),
  );
});
