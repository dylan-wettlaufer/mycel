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
  metadataPaths: readonly string[];
  observedAt: number;
  captureStartedAt: number;
  capturedAt: number;
}

export interface SourceChangeQueueOptions {
  root: string;
  indexing?: Partial<IndexingSettings>;
  initialHashes: ReadonlyMap<string, string>;
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
  let pending = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = Promise.resolve();
  let closed = false;

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
      const candidates = new Set(changes.keys());
      for (const path of included) if (!hashes.has(path)) candidates.add(path);
      for (const path of hashes.keys())
        if (!included.has(path)) candidates.add(path);
      const files = new Map<string, string | null>();
      const nextHashes = new Map<string, string | null>();
      for (const path of [...candidates].sort()) {
        if (!included.has(path)) {
          if (hashes.has(path)) {
            files.set(path, null);
            nextHashes.set(path, null);
          }
          continue;
        }
        let source: string;
        try {
          source = await readRepositoryText(discovered.root, path);
        } catch (error) {
          if (!isMissing(error)) throw error;
          if (hashes.has(path)) {
            files.set(path, null);
            nextHashes.set(path, null);
          }
          continue;
        }
        const hash = hashContent(source);
        if (hash === hashes.get(path)) continue;
        files.set(path, source);
        nextHashes.set(path, hash);
      }
      if (
        closed ||
        (!files.size && ![...changes.keys()].some(isResolutionMetadata))
      )
        return;
      await options.onBatch({
        files,
        metadataPaths: discovered.metadataPaths,
        observedAt: Math.min(...changes.values()),
        captureStartedAt,
        capturedAt: performance.now(),
      });
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
    const next = running.then(process);
    running = next.catch(() => {});
    return next;
  }

  return {
    enqueue(change: SourceChange): void {
      if (closed) return;
      pending.set(change.path, pending.get(change.path) ?? change.observedAt);
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
