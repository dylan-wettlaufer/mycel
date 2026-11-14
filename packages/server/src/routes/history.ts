import { Hono } from "hono";
import type { HistoryQueries } from "@mycel/core";
import { HTTPException } from "hono/http-exception";
function cursor(value: string | undefined): string | undefined {
  if (
    value !== undefined &&
    (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)))
  )
    throw new HTTPException(400, { message: "Invalid event cursor" });
  return value;
}
export function createHistoryRoutes(history?: HistoryQueries) {
  const routes = new Hono();
  routes.onError((error, c) => {
    if (error instanceof HTTPException)
      return c.json({ error: error.message }, error.status);
    console.error("History query failed:", error);
    return c.json({ error: "History query failed" }, 500);
  });
  routes.get("/changes", (c) => {
    if (
      (c.req.queries("cursor")?.length ?? 0) > 1 ||
      (c.req.queries("limit")?.length ?? 0) > 1
    )
      throw new HTTPException(400, {
        message: "Duplicate pagination parameters",
      });
    const after = cursor(c.req.query("cursor"));
    const raw = c.req.query("limit");
    if (
      raw !== undefined &&
      (!/^[0-9]+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100)
    )
      throw new HTTPException(400, {
        message: "limit must be between 1 and 100",
      });
    if (!history) return c.json({ error: "History unavailable" }, 503);
    return c.json(
      history.listChanges({
        ...(after === undefined ? {} : { cursor: after }),
        limit: raw === undefined ? 50 : Number(raw),
      }),
    );
  });
  routes.get("/changes/:id/diff", (c) => {
    const id = cursor(c.req.param("id"))!;
    if (!history) return c.json({ error: "History unavailable" }, 503);
    const diff = history.getDiff(id);
    return diff ? c.json(diff) : c.json({ error: "Change not found" }, 404);
  });
  return routes;
}
