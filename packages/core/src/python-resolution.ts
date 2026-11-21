import { posix } from "node:path";
import type { ParsedImport } from "@mycel/parser";

/** Resolve module-level imports against indexed Python files only. */
export function resolvePythonImport(
  from: string,
  { specifier, bindings }: ParsedImport,
  paths: ReadonlySet<string>,
): string[] {
  const prefix = specifier.match(/^\.+/)?.[0] ?? "";
  const module = specifier.slice(prefix.length).split(".").join("/");
  let roots = [".", "src"];
  if (prefix) {
    const directories = from.split("/").slice(0, -1);
    if (prefix.length > directories.length) return [];
    roots = [
      directories.slice(0, directories.length - prefix.length + 1).join("/"),
    ];
  }

  const initializer = (base: string) => posix.join(base, "__init__.py");
  function findModule(base: string): string | undefined {
    // A plain module cannot contain submodules. A package with the same name
    // takes precedence over that module.
    for (
      let parent = posix.dirname(base);
      parent !== ".";
      parent = posix.dirname(parent)
    ) {
      if (paths.has(`${parent}.py`) && !paths.has(initializer(parent))) return;
    }
    const init = initializer(base);
    if (paths.has(init)) return init;
    if (base !== "." && paths.has(`${base}.py`)) return `${base}.py`;
  }

  for (const root of roots) {
    const base = posix.join(root, module);
    const target = findModule(base);
    const targets = bindings.length
      ? bindings.map(
          ({ imported }) => findModule(posix.join(base, imported)) ?? target,
        )
      : [target];
    const resolved = targets.filter(
      (path): path is string => path !== undefined,
    );
    if (resolved.length) return resolved;
  }
  return [];
}
