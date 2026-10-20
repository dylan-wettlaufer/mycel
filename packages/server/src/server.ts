import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import type { AppOptions } from "./app.js";

/** Starts the local backend. Port 0 lets the OS choose an available port. */
export function startServer(port = 3000, options: AppOptions = {}) {
  return serve({
    fetch: createApp(options).fetch,
    hostname: "127.0.0.1",
    port,
  });
}
