import { basename } from "node:path";
import { fileURLToPath } from "node:url";

import { startServer } from "./server.js";

// The standalone development server targets the Mycel workspace.
// The CLI supplies the repository selected by the user's working directory.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const server = startServer(3000, { project: { name: basename(root), root } });

server.on("listening", () => {
  console.info("Mycel server listening at http://127.0.0.1:3000");
});

server.on("error", (error) => {
  console.error("Mycel server failed:", error.message);
  process.exitCode = 1;
});

function shutdown() {
  server.close((error) => {
    if (error) {
      console.error("Mycel server shutdown failed:", error.message);
    }
    process.exit(error ? 1 : 0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
