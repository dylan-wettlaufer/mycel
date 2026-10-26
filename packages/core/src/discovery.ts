import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { join, posix } from "node:path";
import ignore from "ignore";
import type { Ignore } from "ignore";
import picomatch from "picomatch";
import type { IndexingSettings } from "@mycel/shared";
import { isMissing, readRepositoryText } from "./files.js";
import { resolveIndexingSettings } from "./settings.js";

const excludedDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".pnpm-store",
  ".next",
]);

interface IgnoreRules {
  base: string;
  matcher: Ignore;
}

export interface DiscoveredSources {
  root: string;
  /** Sorted repository-relative paths using forward slashes. */
  paths: string[];
}

function isIgnored(
  path: string,
  directory: boolean,
  rules: readonly IgnoreRules[],
): boolean {
  let ignored = false;
  for (const rule of rules) {
    const relative = rule.base ? path.slice(rule.base.length + 1) : path;
    const result = rule.matcher.test(relative + (directory ? "/" : ""));
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }
  return ignored;
}

/** Traverse working-tree source without requiring Git or running repository code. */
export async function discoverSourceFiles(
  projectRoot: string,
  input?: Partial<IndexingSettings>,
): Promise<DiscoveredSources> {
  const settings = resolveIndexingSettings(input);
  if (typeof projectRoot !== "string" || !projectRoot)
    throw new TypeError("A project root is required");
  const root = await realpath(projectRoot);
  if (!(await stat(root)).isDirectory())
    throw new Error("Project root must be a directory");
  const excluded = picomatch(settings.exclude, {
    dot: true,
    nonegate: true,
    strictBrackets: true,
  });
  const paths: string[] = [];
  const stack: { path: string; rules: IgnoreRules[] }[] = [
    { path: "", rules: [] },
  ];
  while (stack.length) {
    const entry = stack.pop();
    if (!entry) break;
    const absoluteDirectory = join(root, entry.path);
    if ((await realpath(absoluteDirectory)) !== absoluteDirectory)
      throw new Error(`Directory changed to a symbolic link: ${entry.path}`);
    let rules = entry.rules;
    if (settings.respectGitignore) {
      const ignorePath = posix.join(entry.path, ".gitignore");
      let exists = false;
      try {
        exists = (await lstat(join(root, ignorePath))).isFile();
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      if (exists)
        rules = [
          ...rules,
          {
            base: entry.path,
            matcher: ignore({ ignorecase: false }).add(
              await readRepositoryText(root, ignorePath),
            ),
          },
        ];
    }
    const children = await readdir(absoluteDirectory, { withFileTypes: true });
    for (const child of children) {
      if (child.isSymbolicLink() || child.name.includes("\\")) continue;
      const path = posix.join(entry.path, child.name);
      const directory = child.isDirectory();
      if (directory && excludedDirectories.has(child.name)) continue;
      if (
        excluded(path) ||
        (directory && excluded(`${path}/`)) ||
        isIgnored(path, directory, rules)
      )
        continue;
      if (directory) stack.push({ path, rules });
      else if (
        child.isFile() &&
        settings.extensions.some((extension) => path.endsWith(extension))
      )
        paths.push(path);
    }
  }
  return { root, paths: paths.sort() };
}
