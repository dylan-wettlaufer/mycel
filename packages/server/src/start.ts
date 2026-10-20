import { startServer } from "./server.js";

const server = startServer();

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
