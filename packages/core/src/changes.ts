import { performance } from "node:perf_hooks";
import type { IndexingSettings } from "@mycel/shared";
import { discoverSourceFiles } from "./discovery.js";
import {
  isResolutionMetadata,
  isMissing,
  readRepositoryText,
} from "./files.js";
import { hashContent } from "./graph.js";
import type { SourceChange } from "./watcher.js";

export interface SourceBatch {
  /** Null represents a deletion or a file excluded by current ignore rules. */
  files: ReadonlyMap<string, string | null>;
  readErrors: ReadonlyMap<string, string>;
  fileCaptureTimes: ReadonlyMap<string, number>;
  metadataPaths: readonly string[];
  observedAt: number;
  captureStartedAt: number;
  capturedAt: number;
}

export interface SourceChangeQueueOptions {
  root: string;
  indexing?: Partial<IndexingSettings>;
  initialHashes: ReadonlyMap<string, string>;
  initialReadErrors?: ReadonlyMap<string, string>;
  debounceMs?: number;
  onBatch(batch: SourceBatch): Promise<void>;
  onError(error: unknown): void;
}

/** Coalesce saves and serialize capture/commit; hashes advance only on success. */
export function createSourceChangeQueue(options: SourceChangeQueueOptions) {
  const debounceMs = options.debounceMs ?? 75;
  if (
    !Number.isSafeInteger(debounceMs) ||
    debounceMs < 0 ||
    debounceMs > 0x7fffffff
  )
    throw new RangeError(
      "debounceMs must be an integer between 0 and 2147483647",
    );
  const hashes = new Map(options.initialHashes);
  let readErrors = new Map(options.initialReadErrors);
  let pending = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = Promise.resolve();
  let closed = false;
  let retryAttempt = 0;
  const retryDelays = [100, 500, 2000];

  async function process() {
    if (closed || !pending.size) return;
    const captureStartedAt = performance.now();
    const changes = pending;
    pending = new Map();
    try {
      const discovered = await discoverSourceFiles(
        options.root,
        options.indexing,
      );
      const included = new Set(discovered.paths);
      const candidates = new Set([...changes.keys(), ...readErrors.keys()]);
      const nextErrors = new Map(readErrors);
      for (const path of included) if (!hashes.has(path)) candidates.add(path);
      for (const path of hashes.keys())
        if (!included.has(path)) candidates.add(path);
      const files = new Map<string, string | null>();
      const fileCaptureTimes = new Map<string, number>();
      const nextHashes = new Map<string, string | null>();
      for (const path of [...candidates].sort()) {
        let source: string | null = null;
        if (included.has(path)) {
          try {
            source = await readRepositoryText(discovered.root, path);
          } catch (error) {
            if (!isMissing(error)) {
              nextErrors.set(
                path,
                error instanceof Error ? error.message : String(error),
              );
              continue;
            }
          }
        }
        nextErrors.delete(path);
        const hash = source === null ? undefined : hashContent(source);
        if (hash === hashes.get(path) && !readErrors.has(path)) continue;
        fileCaptureTimes.set(path, Date.now());
        files.set(path, source);
        nextHashes.set(path, hash ?? null);
      }
      const errorsChanged =
        nextErrors.size !== readErrors.size ||
        [...nextErrors].some(
          ([path, reason]) => readErrors.get(path) !== reason,
        );
      if (
        closed ||
        (!files.size &&
          !errorsChanged &&
          ![...changes.keys()].some(isResolutionMetadata))
      )
        return;
      await options.onBatch({
        files,
        fileCaptureTimes,
        readErrors: nextErrors,
        metadataPaths: discovered.metadataPaths,
        observedAt: Math.min(...changes.values()),
        captureStartedAt,
        capturedAt: performance.now(),
      });
      readErrors = nextErrors;
      for (const [path, hash] of nextHashes) {
        if (hash === null) hashes.delete(path);
        else hashes.set(path, hash);
      }
    } catch (error) {
      for (const [path, time] of changes)
        pending.set(path, Math.min(time, pending.get(path) ?? time));
      throw error;
    }
  }

  function flush(): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    const next = running.then(process).finally(() => {
      const delay = retryDelays[retryAttempt];
      if (
        closed ||
        timer !== undefined ||
        delay === undefined ||
        (!pending.size && !readErrors.size)
      )
        return;
      retryAttempt++;
      timer = setTimeout(() => {
        for (const path of readErrors.keys())
          if (!pending.has(path)) pending.set(path, performance.now());
        void flush().catch(options.onError);
      }, delay);
      timer.unref();
    });
    running = next.catch(() => {});
    return next;
  }

  return {
    enqueue(change: SourceChange): void {
      if (closed) return;
      pending.set(change.path, pending.get(change.path) ?? change.observedAt);
      retryAttempt = 0;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void flush().catch(options.onError);
      }, debounceMs);
    },
    flush,
    close(): Promise<void> {
      closed = true;
      clearTimeout(timer);
      pending.clear();
      return running;
    },
  };
}
