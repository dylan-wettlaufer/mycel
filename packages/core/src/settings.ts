import type { IndexingSettings } from "@mycel/shared";

export function resolveIndexingSettings(
  input: Partial<IndexingSettings> = {},
): IndexingSettings {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Indexing settings must be an object");
  }
  const extensions: IndexingSettings["extensions"] =
    input.extensions === undefined ? [".ts", ".tsx"] : input.extensions;
  const exclude = input.exclude === undefined ? [] : input.exclude;
  const respectGitignore =
    input.respectGitignore === undefined ? true : input.respectGitignore;
  if (
    !Array.isArray(extensions) ||
    extensions.some((extension) => extension !== ".ts" && extension !== ".tsx")
  ) {
    throw new TypeError("Indexing extensions must be .ts or .tsx");
  }
  if (
    !Array.isArray(exclude) ||
    exclude.some(
      (pattern) =>
        typeof pattern !== "string" || !pattern || pattern.includes("\0"),
    )
  ) {
    throw new TypeError("Exclusions must be nonempty glob strings");
  }
  if (typeof respectGitignore !== "boolean")
    throw new TypeError("respectGitignore must be a boolean");
  return {
    extensions: [...new Set(extensions)],
    exclude: [...exclude],
    respectGitignore,
  };
}
