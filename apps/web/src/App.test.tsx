import {
  cleanup,
  fireEvent,
  render,
  screen,
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
