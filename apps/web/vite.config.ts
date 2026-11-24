import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiOrigin = "http://127.0.0.1:3000";

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
        target: apiOrigin,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (forwarded, request) => {
            const { host, origin } = request.headers;
            const port = request.socket.localPort;
            const suffix = port === 80 ? "" : `:${port}`;
            let authority = host?.toLowerCase();
            if (port === 80) authority = authority?.replace(/:80$/, "");
            const localHost =
              authority === `127.0.0.1${suffix}` ||
              authority === `localhost${suffix}`;
            if (
              !localHost ||
              (origin !== undefined && origin !== `http://${authority}`)
            )
              forwarded.setHeader("origin", "null");
            else if (origin !== undefined)
              forwarded.setHeader("origin", apiOrigin);
          });
        },
      },
    },
  },
});
