import { useEffect, useState } from "react";

import { fetchHealth } from "@/lib/api";
import type { ConnectionStatus } from "@/lib/api";

const pollInterval = 5000;
const requestTimeout = 3000;

export function useBackendHealth(): ConnectionStatus {
  const [connection, setConnection] = useState<ConnectionStatus>("checking");

  useEffect(() => {
    let disposed = false;
    let pollTimer: ReturnType<typeof setTimeout>;
    let requestTimer: ReturnType<typeof setTimeout>;
    let controller: AbortController;

    async function check() {
      controller = new AbortController();
      requestTimer = setTimeout(() => controller.abort(), requestTimeout);

      try {
        await fetchHealth(controller.signal);
        if (!disposed) setConnection("connected");
      } catch {
        if (!disposed) setConnection("disconnected");
      } finally {
        clearTimeout(requestTimer);
        if (!disposed) pollTimer = setTimeout(check, pollInterval);
      }
    }

    void check();
    return () => {
      disposed = true;
      clearTimeout(pollTimer);
      clearTimeout(requestTimer);
      controller.abort();
    };
  }, []);

  return connection;
}
