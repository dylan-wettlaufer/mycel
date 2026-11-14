import { performance } from "node:perf_hooks";
import { commitChangeSet, readGraphState } from "@mycel/db";
import { diffGraph } from "./history.js";
import type { Diagnostic } from "@mycel/shared";
import { parseFile } from "@mycel/parser";
import { createSourceChangeQueue } from "./changes.js";
import { buildProjectGraph, hashContent } from "./graph.js";
import { captureRepository } from "./indexer.js";
import type { IndexRepositoryOptions } from "./indexer.js";
import { watchSourceFiles } from "./watcher.js";
import type { SourceChange } from "./watcher.js";

/** Monotonic milliseconds, measured from the first observed filesystem event. */
export interface GraphUpdateTiming {
  readonly revision: number;
  readonly changedPaths: readonly string[];
  readonly retainedPaths: readonly string[];
  readonly observedAt: number;
  readonly completedAt: number;
  readonly latencyMs: number;
  readonly queueMs: number;
  readonly captureMs: number;
  readonly parseMs: number;
  readonly resolveMs: number;
  readonly writeMs: number;
}

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
    const initialGraph = buildProjectGraph(project, [...files.values()]);
    const initialChanges = diffGraph(
      readGraphState(options.database, project.id),
      initialGraph,
    );
    commitChangeSet(options.database, {
      graph: initialGraph,
      sources: new Map([...files].map(([path, file]) => [path, file.source])),
      changes: initialChanges,
    });
    let failures = new Map<string, Diagnostic[]>();
    let lastUpdate: GraphUpdateTiming | undefined;
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
        const parseStartedAt = performance.now();
        const next = new Map(files);
        const nextFailures = new Map(failures);
        const retainedPaths: string[] = [];
        for (const [path, source] of batch.files) {
          nextFailures.delete(path);
          if (source === null) {
            next.delete(path);
            continue;
          }
          const previous = files.get(path);
          try {
            const parsed = parse(path, source);
            if (
              parsed.status === "partial" &&
              previous?.parsed.status === "parsed"
            ) {
              nextFailures.set(path, parsed.diagnostics);
              retainedPaths.push(path);
            } else next.set(path, { source, parsed });
          } catch (error) {
            nextFailures.set(path, [
              {
                path,
                source: "parser",
                severity: "error",
                code: "parser-failure",
                message: error instanceof Error ? error.message : String(error),
                range: {
                  start: 0,
                  end: 0,
                  startLine: 1,
                  startColumn: 1,
                  endLine: 1,
                  endColumn: 1,
                },
              },
            ]);
            if (previous) retainedPaths.push(path);
          }
        }
        const parsedAt = performance.now();
        const graph = buildProjectGraph(project, [...next.values()]);
        // Current syntax diagnostics accompany retained nodes and relationships.
        graph.diagnostics = [
          ...graph.diagnostics.filter(
            (d) => d.source !== "parser" || !nextFailures.has(d.path),
          ),
          ...[...nextFailures.values()].flat(),
        ];
        const resolvedAt = performance.now();
        const { revision } = commitChangeSet(options.database, {
          graph,
          sources: new Map(
            [...next].map(([path, file]) => [path, file.source]),
          ),
          changes: diffGraph(
            readGraphState(options.database, project.id),
            graph,
          ),
        });
        const completedAt = performance.now();
        files = next;
        failures = nextFailures;
        lastUpdate = Object.freeze({
          revision,
          changedPaths: Object.freeze([...batch.files.keys()]),
          retainedPaths: Object.freeze(retainedPaths),
          observedAt: batch.observedAt,
          completedAt,
          latencyMs: completedAt - batch.observedAt,
          queueMs: batch.captureStartedAt - batch.observedAt,
          captureMs: batch.capturedAt - batch.captureStartedAt,
          parseMs: parsedAt - parseStartedAt,
          resolveMs: resolvedAt - parsedAt,
          writeMs: completedAt - resolvedAt,
        });
      },
    });
    // Recheck the startup snapshot even if OS events have not arrived yet.
    for (const path of [...captured.paths, ".gitignore"])
      queue.enqueue({ kind: "change", path, observedAt: performance.now() });
    for (const change of startup) queue.enqueue(change);
    await queue.flush();
    return {
      project,
      get lastUpdate(): GraphUpdateTiming | undefined {
        return lastUpdate;
      },
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
