import { performance } from "node:perf_hooks";
import { applyProjectGraph, replaceProjectGraph } from "@mycel/db";
import { parseFile } from "@mycel/parser";
import { createSourceChangeQueue } from "./changes.js";
import { buildProjectGraph, hashContent } from "./graph.js";
import { captureRepository } from "./indexer.js";
import type { IndexRepositoryOptions } from "./indexer.js";
import { watchSourceFiles } from "./watcher.js";
import type { SourceChange } from "./watcher.js";

export interface WatchRepositoryOptions extends IndexRepositoryOptions {
  debounceMs?: number;
  onError(error: unknown): void;
  /** Alternate parser for engine integrations; defaults to the TypeScript parser. */
  parse?: typeof parseFile;
}

/** Watch before capture so saves during startup are reconciled before returning. */
export async function watchRepository(options: WatchRepositoryOptions) {
  const startup: SourceChange[] = [];
  let queue: ReturnType<typeof createSourceChangeQueue> | undefined;
  const watcher = watchSourceFiles({
    root: options.project.root,
    ...(options.indexing === undefined ? {} : { indexing: options.indexing }),
    onChange: (change) => {
      if (queue) queue.enqueue(change);
      else startup.push(change);
    },
    onError: options.onError,
  });
  try {
    await watcher.ready;
    const parse = options.parse ?? parseFile;
    const captured = await captureRepository(options, parse);
    const { project } = captured;
    let files = new Map(captured.files.map((file) => [file.parsed.path, file]));
    replaceProjectGraph(
      options.database,
      buildProjectGraph(project, [...files.values()]),
    );
    queue = createSourceChangeQueue({
      root: project.root,
      indexing: project.indexing,
      initialHashes: new Map(
        captured.files.map((file) => [
          file.parsed.path,
          hashContent(file.source),
        ]),
      ),
      ...(options.debounceMs === undefined
        ? {}
        : { debounceMs: options.debounceMs }),
      onError: options.onError,
      onBatch: async (batch) => {
        const next = new Map(files);
        for (const [path, source] of batch.files) {
          if (source === null) next.delete(path);
          else next.set(path, { source, parsed: parse(path, source) });
        }
        applyProjectGraph(
          options.database,
          buildProjectGraph(project, [...next.values()]),
        );
        files = next;
      },
    });
    // Recheck the startup snapshot even if OS events have not arrived yet.
    for (const path of [...captured.paths, ".gitignore"])
      queue.enqueue({ kind: "change", path, observedAt: performance.now() });
    for (const change of startup) queue.enqueue(change);
    await queue.flush();
    return {
      project,
      flush: queue.flush,
      close(): Promise<void> {
        // Stop callbacks synchronously, before the owner closes storage.
        return Promise.all([queue!.close(), watcher.close()]).then(() => {});
      },
    };
  } catch (error) {
    await queue?.close();
    await watcher.close();
    throw error;
  }
}
