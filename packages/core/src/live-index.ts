import { loadModuleResolver } from "./module-resolution.js";
import { performance } from "node:perf_hooks";
import {
  commitChangeSet,
  readGraphState,
  startMonitoringSession,
  endMonitoringSession,
} from "@mycel/db";
import { diffGraph } from "./history.js";
import type { ChangeEvent, Diagnostic } from "@mycel/shared";
import { parseFile } from "@mycel/parser";
import { createSourceChangeQueue } from "./changes.js";
import { buildProjectGraph, hashContent } from "./graph.js";
import { architectureFilePath } from "./architecture.js";
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
  onEvent?(event: ChangeEvent): void;
  onError(error: unknown): void;
  /** Alternate parser for engine integrations; defaults to the TypeScript parser. */
  parse?: typeof parseFile;
}

/** Watch before capture so saves during startup are reconciled before returning. */
export async function watchRepository(options: WatchRepositoryOptions) {
  const listeners = new Set<(event: ChangeEvent) => void>();
  const commitListeners = new Set<(revision: number) => void>();
  const architectureFileListeners = new Set<() => void>();
  if (options.onEvent) listeners.add(options.onEvent);
  const publish = (events: ChangeEvent[]) => {
    for (const event of events)
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          try {
            options.onError(error);
          } catch {
            /* Observers cannot invalidate a commit. */
          }
        }
      }
  };
  const notifyCommit = (revision: number) => {
    for (const listener of commitListeners) {
      try {
        listener(revision);
      } catch (error) {
        try {
          options.onError(error);
        } catch {
          /* Observers cannot invalidate a commit. */
        }
      }
    }
  };
  const notifyArchitectureFile = () => {
    for (const listener of architectureFileListeners) {
      try {
        listener();
      } catch (error) {
        try {
          options.onError(error);
        } catch {
          /* Observers cannot invalidate file watching. */
        }
      }
    }
  };
  let sessionId: string | undefined;
  const startup: SourceChange[] = [];
  let queue: ReturnType<typeof createSourceChangeQueue> | undefined;
  const watcher = watchSourceFiles({
    root: options.project.root,
    ...(options.indexing === undefined ? {} : { indexing: options.indexing }),
    onChange: (change) => {
      if (change.path === architectureFilePath) {
        notifyArchitectureFile();
        return;
      }
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
    sessionId = startMonitoringSession(options.database, project);
    const initialGraph = buildProjectGraph(
      project,
      [...files.values()],
      captured.resolution,
    );
    const initialChanges = diffGraph(
      readGraphState(options.database, project.id),
      initialGraph,
    );
    const initialCommit = commitChangeSet(options.database, {
      sessionId,
      graph: initialGraph,
      sources: new Map([...files].map(([path, file]) => [path, file.source])),
      changes: initialChanges,
    });
    publish(initialCommit.events);
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
        const resolution = await loadModuleResolver(
          project.root,
          [...next.keys()],
          batch.metadataPaths,
        );
        const graph = buildProjectGraph(
          project,
          [...next.values()],
          resolution,
        );
        // Current syntax diagnostics accompany retained nodes and relationships.
        graph.diagnostics = [
          ...graph.diagnostics.filter(
            (d) => d.source !== "parser" || !nextFailures.has(d.path),
          ),
          ...[...nextFailures.values()].flat(),
        ];
        const resolvedAt = performance.now();
        const { revision, events } = commitChangeSet(options.database, {
          sessionId: sessionId!,
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
        publish(events);
        if (events.length > 0) notifyCommit(revision);
      },
    });
    // Recheck the startup snapshot even if OS events have not arrived yet.
    for (const path of [
      ...captured.paths,
      ...captured.metadataPaths,
      ".gitignore",
    ])
      queue.enqueue({ kind: "change", path, observedAt: performance.now() });
    for (const change of startup) queue.enqueue(change);
    await queue.flush();
    return {
      project,
      sessionId,
      onEvent(listener: (event: ChangeEvent) => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      onCommit(listener: (revision: number) => void) {
        commitListeners.add(listener);
        return () => {
          commitListeners.delete(listener);
        };
      },
      onArchitectureFile(listener: () => void) {
        architectureFileListeners.add(listener);
        return () => {
          architectureFileListeners.delete(listener);
        };
      },
      get lastUpdate(): GraphUpdateTiming | undefined {
        return lastUpdate;
      },
      flush: queue.flush,
      close(): Promise<void> {
        if (options.database.open)
          endMonitoringSession(options.database, sessionId!);
        listeners.clear();
        commitListeners.clear();
        architectureFileListeners.clear();
        // Stop callbacks synchronously, before the owner closes storage.
        return Promise.all([queue!.close(), watcher.close()]).then(() => {});
      },
    };
  } catch (error) {
    if (sessionId && options.database.open)
      endMonitoringSession(options.database, sessionId);
    await queue?.close();
    await watcher.close();
    throw error;
  }
}
