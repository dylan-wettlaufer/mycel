import { useEffect, useState } from "react";
import type { ChangesPage } from "@mycel/shared";
import { mergeEvents } from "@/hooks/use-activity";
import { request } from "@/lib/api";
import { isChangesPage } from "@/lib/contracts";

/** The Activity view remounts this hook when changing filters. */
export function useChangeFeed(query: string, revision: number) {
  const url = `/api/changes?limit=24&${query}`;
  const [data, setData] = useState<ChangesPage>();
  const [error, setError] = useState<string>();
  const [older, setOlder] = useState<{ cursor: string }>();
  const [loadingMore, setLoadingMore] = useState(false);
  const hasOlder = Boolean(older);

  useEffect(() => {
    const controller = new AbortController();
    void request(url, isChangesPage, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setData((previous) =>
          hasOlder && previous
            ? {
                items: mergeEvents(previous.items, result.items),
                cursor: previous.cursor,
              }
            : result,
        );
        setError(undefined);
      },
      (failure: unknown) => {
        if (!controller.signal.aborted) setError(String(failure));
      },
    );
    return () => controller.abort();
  }, [url, revision, hasOlder]);

  useEffect(() => {
    if (!older) return;
    const controller = new AbortController();
    void request(
      `${url}&cursor=${encodeURIComponent(older.cursor)}`,
      isChangesPage,
      controller.signal,
    ).then(
      (result) => {
        if (controller.signal.aborted) return;
        setData((previous) => ({
          items: mergeEvents(previous?.items ?? [], result.items),
          cursor: result.cursor,
        }));
        setError(undefined);
        setLoadingMore(false);
      },
      (failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(String(failure));
        setLoadingMore(false);
      },
    );
    return () => controller.abort();
  }, [url, older]);

  function loadMore() {
    if (!data?.cursor) return;
    setLoadingMore(true);
    // A new request also allows retrying a page with the same cursor.
    setOlder({ cursor: data.cursor });
  }

  return { data, error, loadingMore, loadMore };
}
