import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { App } from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("the dashboard connection badge reflects the backend health response", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: "ok" }));
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);
  expect(screen.getByRole("status").textContent).toBe("Checking…");

  await screen.findByText("Connected");
  expect(screen.getByRole("status").textContent).toBe("Connected");
  expect(fetchMock).toHaveBeenCalledWith("/api/health", expect.any(Object));
});
