import { basename } from "node:path";
import { fileURLToPath } from "node:url";

import { startIndexedServer } from "./indexed-server.js";

// The standalone development server targets the Mycel workspace.
// The CLI supplies the repository selected by the user's working directory.
const root = fileURLToPath(new URL("../../../", import.meta.url));
async function main() {
  const server = await startIndexedServer(3000, {
    project: { name: basename(root), root },
  });

  console.info("Mycel server listening at http://127.0.0.1:3000");

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
}

main().catch((error: unknown) => {
  console.error(
    "Mycel server failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
