import { serve } from "@hono/node-server";

import { createApp } from "./app.js";

/** Starts the local backend. Port 0 lets the OS choose an available port. */
export function startServer(port = 3000) {
  return serve({
    fetch: createApp().fetch,
    hostname: "127.0.0.1",
    port,
  });
}
