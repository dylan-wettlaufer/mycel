import { useEffect, useReducer, useState } from "react";
import { request } from "@/lib/api";

/** Abort obsolete reads and never display a response for a different URL. */
export function useResource<T>(
  url: string | null,
  validate: (value: unknown) => value is T,
  revision = 0,
  retainOnError = false,
) {
  const [attempt, retry] = useReducer((value: number) => value + 1, 0);
  const [state, setState] = useState<{
    url: string;
    revision: number;
    attempt: number;
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
          if (!disposed) setState({ url, revision, attempt, data });
        },
        (error) => {
          if (disposed) return;
          const message = controller.signal.aborted
            ? "The request timed out."
            : error instanceof Error
              ? error.message
              : String(error);
          setState((previous) => ({
            url,
            revision,
            attempt,
            error: message,
            ...(retainOnError && previous?.url === url && "data" in previous
              ? { data: previous.data }
              : {}),
          }));
        },
      )
      .finally(() => clearTimeout(timeout));
    return () => {
      disposed = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [url, validate, revision, attempt, retainOnError]);
  const current = state?.url === url ? state : undefined;
  return {
    data: current?.data,
    error: current?.error,
    loading:
      url !== null &&
      (current?.revision !== revision || current.attempt !== attempt),
    retry,
  };
}
