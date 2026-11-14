import { useEffect, useState } from "react";
import { request } from "@/lib/api";

/** Abort obsolete reads and never display a response for a different URL. */
export function useResource<T>(
  url: string | null,
  validate: (value: unknown) => value is T,
  revision = 0,
) {
  const [state, setState] = useState<{
    url: string;
    data?: T;
    error?: string;
  }>();
  useEffect(() => {
    if (!url) return;
    let disposed = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    void request(url, validate, controller.signal)
      .then(
        (data) => {
          if (!disposed) setState({ url, data });
        },
        (error) => {
          if (!disposed) setState({ url, error: String(error) });
        },
      )
      .finally(() => clearTimeout(timeout));
    return () => {
      disposed = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [url, validate, revision]);
  return {
    data: state?.url === url ? state.data : undefined,
    error: state?.url === url ? state.error : undefined,
  };
}
