import { createHash } from "node:crypto";
import { lstatSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  win32,
} from "node:path";

interface DataEnvironment {
  XDG_DATA_HOME?: string;
  LOCALAPPDATA?: string;
}

/** Kept pure so platform conventions can be checked without changing the host. */
export function defaultDataDirectory(
  platform: string,
  homeDirectory: string,
  environment: DataEnvironment,
): string {
  if (platform === "win32") {
    const base = environment.LOCALAPPDATA;
    return win32.join(
      base && win32.isAbsolute(base)
        ? base
        : win32.join(homeDirectory, "AppData", "Local"),
      "Mycel",
    );
  }
  if (platform === "darwin")
    return posix.join(homeDirectory, "Library", "Application Support", "Mycel");
  const base = environment.XDG_DATA_HOME;
  return posix.join(
    base && posix.isAbsolute(base)
      ? base
      : posix.join(homeDirectory, ".local", "share"),
    "mycel",
  );
}

function canonicalProjectRoot(projectRoot: string): string {
  if (typeof projectRoot !== "string" || !projectRoot)
    throw new TypeError("A project root is required for an on-disk database");
  const root = realpathSync(projectRoot);
  if (!statSync(root).isDirectory())
    throw new Error("Project root must be a directory");
  return root;
}

/** Resolve existing ancestors as well as existing files, including symlinks. */
function canonicalDestination(path: string): string {
  let ancestor = resolve(path);
  const suffix: string[] = [];
  while (true) {
    try {
      lstatSync(ancestor);
      break;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      suffix.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
  return join(realpathSync(ancestor), ...suffix);
}

export function resolveExternalDatabasePath(
  projectRoot: string,
  databasePath: string,
): string {
  const root = canonicalProjectRoot(projectRoot);
  if (
    typeof databasePath !== "string" ||
    !isAbsolute(databasePath) ||
    databasePath.trim() !== databasePath
  ) {
    throw new TypeError(
      "Database path must be absolute, with no leading or trailing whitespace",
    );
  }
  const destination = canonicalDestination(databasePath);
  const fromRoot = relative(root, destination);
  if (
    !fromRoot ||
    (fromRoot !== ".." &&
      !fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(fromRoot))
  ) {
    throw new Error(
      "The database must be stored outside the project repository",
    );
  }
  return destination;
}

/** Computes a location only; directory/file creation happens in openDatabase. */
export function resolveDatabasePath(
  projectRoot: string,
  dataDirectory?: string,
): string {
  const root = canonicalProjectRoot(projectRoot);
  const directory =
    dataDirectory ??
    defaultDataDirectory(process.platform, homedir(), process.env);
  if (!isAbsolute(directory))
    throw new TypeError("Data directory must be absolute");
  const key = createHash("sha256").update(root).digest("hex");
  return resolveExternalDatabasePath(
    root,
    join(directory, "projects", `${key}.sqlite`),
  );
}
