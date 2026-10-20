import type { HealthResponse } from "@mycel/shared";
import { Hono } from "hono";

export function createApp() {
  const app = new Hono();

  app.get("/api/health", (context) => {
    const response: HealthResponse = { status: "ok" };
    return context.json(response);
  });

  return app;
}
