import type { ProjectInfo } from "@mycel/shared";
import { useEffect, useState } from "react";

import { fetchProject } from "@/lib/api";
import type { ConnectionStatus } from "@/lib/api";

export function useProject(connection: ConnectionStatus) {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (connection !== "connected") return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let disposed = false;

    setError(false);
    fetchProject(controller.signal)
      .then((response) => { if (!disposed) setProject(response); })
      .catch(() => { if (!disposed) setError(true); })
      .finally(() => clearTimeout(timeout));

    return () => {
      disposed = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [connection]);

  return { project, error };
}
