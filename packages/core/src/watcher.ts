import { relative, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { watch } from "chokidar";
import type { IndexingSettings } from "@mycel/shared";
import { excludedDirectories } from "./discovery.js";
import { resolveIndexingSettings } from "./settings.js";

export interface SourceChange {
  kind: "add" | "change" | "unlink";
  path: string;
  observedAt: number;
}

export interface SourceWatcherOptions {
  root: string;
  indexing?: Partial<IndexingSettings>;
  onChange(change: SourceChange): void;
  onError(error: unknown): void;
}

/** Renames arrive as unlink/add; identities follow repository-relative paths. */
export function watchSourceFiles(options: SourceWatcherOptions) {
  const settings = resolveIndexingSettings(options.indexing);
  const watcher = watch(options.root, {
    ignoreInitial: true,
    followSymlinks: false,
    atomic: true,
    ignored: (path) =>
      relative(options.root, path)
        .split(sep)
        .some((part) => excludedDirectories.has(part)),
  });
  let closed = false;
  watcher.on("all", (kind, absolutePath) => {
    if (closed || (kind !== "add" && kind !== "change" && kind !== "unlink"))
      return;
    const path = relative(options.root, absolutePath).split(sep).join("/");
    if (
      path === ".." ||
      path.startsWith("../") ||
      path.includes("\\") ||
      (!settings.extensions.some((extension) => path.endsWith(extension)) &&
        !(settings.respectGitignore && path.split("/").at(-1) === ".gitignore"))
    )
      return;
    options.onChange({ kind, path, observedAt: performance.now() });
  });
  const ready = new Promise<void>((resolve, reject) => {
    watcher.once("ready", resolve);
    watcher.on("error", (error) => {
      reject(error);
      options.onError(error);
    });
  });
  return {
    ready,
    close(): Promise<void> {
      closed = true;
      return watcher.close();
    },
  };
}
