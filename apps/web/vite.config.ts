import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (forwarded, request) => {
            const { host, origin } = request.headers;
            const port = request.socket.localPort;
            if (origin !== undefined) {
              const localHost =
                host === `127.0.0.1:${port}` || host === `localhost:${port}`;
              forwarded.setHeader(
                "origin",
                localHost && origin === `http://${host}`
                  ? "http://127.0.0.1:3000"
                  : "null",
              );
            }
          });
        },
      },
    },
  },
});
