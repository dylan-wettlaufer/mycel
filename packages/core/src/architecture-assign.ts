import picomatch from "picomatch";
import type {
  ArchitectureAssignment,
  ArchitectureFile,
  ArchitecturePart,
  ArchitectureTieWarning,
  AssignedArchitecturePart,
} from "@mycel/shared";
import { inferKind, normalizeLine, slugify } from "./architecture-fallback.js";

export interface AssignFilesOptions {
  /**
   * Optional fallback architecture (for example from `buildFallbackArchitecture`)
   * used to assign files unmatched by `architecture.parts` to their workspace or
   * folder part before synthesizing a top-level folder part.
   */
  fallback?: ArchitectureFile;
}

/** Project a parent's ownership into children while retaining external owners. */
export function assignComponentFiles(
  assignment: ArchitectureAssignment,
  parent: AssignedArchitecturePart,
  indexedPaths: ReadonlySet<string>,
): ArchitectureAssignment {
  const children: ArchitecturePart[] = (parent.subcomponents ?? []).map(
    (child) => ({
      ...child,
      id: `${parent.id}:${child.id}`,
      kind: parent.kind,
    }),
  );
  const local = assignFilesToParts(
    { version: 1, parts: children },
    parent.files,
  );
  const unassigned = new Set(local.unassignedFiles);
  const otherId = `${parent.id}::other`;
  const fileToPart = Object.fromEntries(
    Object.entries(assignment.fileToPart).map(([path, owner]) => [
      path,
      owner === parent.id
        ? unassigned.has(path)
          ? otherId
          : local.fileToPart[path]!
        : owner,
    ]),
  );
  const declaredIds = new Set(children.map(({ id }) => id));
  const parts = local.parts.filter(({ id }) => declaredIds.has(id));
  if (unassigned.size > 0) {
    parts.push({
      id: otherId,
      name: "Other files",
      purpose: "Files in this component without a named responsibility.",
      kind: parent.kind,
      paths: [],
      files: local.unassignedFiles,
    });
  }
  parts.push(...assignment.parts.filter(({ id }) => id !== parent.id));
  return {
    parts: parts.map((entry) => ({
      ...entry,
      files: entry.files.filter((path) => indexedPaths.has(path)),
    })),
    fileToPart,
    unassignedFiles: local.unassignedFiles.filter((path) =>
      indexedPaths.has(path),
    ),
    tieWarnings: local.tieWarnings.filter(({ path }) => indexedPaths.has(path)),
  };
}

interface PatternSpecificity {
  literalSegments: number;
  length: number;
}

interface CompiledPattern {
  pattern: string;
  specificity: PatternSpecificity;
  matches(path: string): boolean;
}

interface CompiledPart {
  part: ArchitecturePart;
  patterns: CompiledPattern[];
}

interface PartMatch {
  part: ArchitecturePart;
  pattern: CompiledPattern;
}

function isGlobSegment(segment: string): boolean {
  return /[*?[\]{}]|[!@+*?]\(/.test(segment);
}

function computeSpecificity(pattern: string): PatternSpecificity {
  const segments = pattern.split("/");
  let literalSegments = 0;
  for (const segment of segments) {
    if (isGlobSegment(segment)) break;
    literalSegments++;
  }
  return { literalSegments, length: pattern.length };
}

function compareSpecificity(
  a: PatternSpecificity,
  b: PatternSpecificity,
): number {
  if (a.literalSegments !== b.literalSegments)
    return a.literalSegments - b.literalSegments;
  return a.length - b.length;
}

function compilePattern(pattern: string): CompiledPattern {
  const specificity = computeSpecificity(pattern);
  const segments = pattern.split("/");
  const isLiteralPath = segments.every((segment) => !isGlobSegment(segment));
  const globMatch = picomatch(pattern, { dot: true, nonegate: true });
  const prefix = `${pattern}/`;

  return {
    pattern,
    specificity,
    matches(path: string): boolean {
      if (isLiteralPath) {
        return path === pattern || path.startsWith(prefix);
      }
      return globMatch(path);
    },
  };
}

function compileParts(parts: readonly ArchitecturePart[]): CompiledPart[] {
  return parts.map((part) => ({
    part,
    patterns: part.paths.map(compilePattern),
  }));
}

/** Report stale patterns even when another pattern covers the same part. */
export function findUnmatchedPatterns(
  architecture: ArchitectureFile,
  filePaths: readonly string[],
): { partId: string; pattern: string }[] {
  return compileParts(architecture.parts).flatMap(({ part, patterns }) =>
    patterns
      .filter((pattern) => !filePaths.some((path) => pattern.matches(path)))
      .map(({ pattern }) => ({ partId: part.id, pattern })),
  );
}

function bestMatchForPart(
  compiled: CompiledPart,
  path: string,
): CompiledPattern | undefined {
  let best: CompiledPattern | undefined;
  for (const pattern of compiled.patterns) {
    if (!pattern.matches(path)) continue;
    if (
      !best ||
      compareSpecificity(pattern.specificity, best.specificity) > 0
    ) {
      best = pattern;
    }
  }
  return best;
}

function findWinningMatches(
  compiledParts: readonly CompiledPart[],
  path: string,
): PartMatch[] {
  let winners: PartMatch[] = [];
  for (const compiled of compiledParts) {
    const matched = bestMatchForPart(compiled, path);
    if (!matched) continue;
    if (winners.length === 0) {
      winners = [{ part: compiled.part, pattern: matched }];
      continue;
    }
    const comparison = compareSpecificity(
      matched.specificity,
      winners[0]!.pattern.specificity,
    );
    if (comparison > 0) {
      winners = [{ part: compiled.part, pattern: matched }];
    } else if (comparison === 0) {
      winners.push({ part: compiled.part, pattern: matched });
    }
  }
  return winners;
}

function normalizeFilePath(raw: string): string | undefined {
  let value = raw.replaceAll("\\", "/").trim();
  while (value.startsWith("./")) value = value.slice(2);
  while (value.endsWith("/")) value = value.slice(0, -1);
  return value || undefined;
}

function allocateFallbackId(preferred: string, usedIds: Set<string>): string {
  const base = slugify(preferred) || "fallback";
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }

  const withSuffix = `${base.slice(0, 64 - "-fallback".length).replace(/-+$/, "") || "part"}-fallback`;
  if (!usedIds.has(withSuffix)) {
    usedIds.add(withSuffix);
    return withSuffix;
  }

  let counter = 2;
  while (true) {
    const suffix = `-fallback-${counter}`;
    const prefix = base
      .slice(0, Math.max(1, 64 - suffix.length))
      .replace(/-+$/, "");
    const candidate = `${prefix || "part"}${suffix}`;
    if (!usedIds.has(candidate)) {
      usedIds.add(candidate);
      return candidate;
    }
    counter++;
  }
}

function synthesizeFolderPart(filePath: string): {
  key: string;
  template: ArchitecturePart;
} {
  const slash = filePath.indexOf("/");
  if (slash < 0) {
    return {
      key: "synthetic:",
      template: {
        id: "root",
        name: "root",
        purpose: "Source files at the repository root.",
        kind: "library",
        paths: ["*"],
      },
    };
  }
  const folder = filePath.slice(0, slash);
  const name = normalizeLine(folder, 80) || "folder";
  return {
    key: `synthetic:${folder}`,
    template: {
      id: slugify(folder) || "folder",
      name,
      purpose: normalizeLine(`Source files in ${folder}.`, 200),
      kind: inferKind(folder, name),
      paths: [`${folder}/**`],
    },
  };
}

/**
 * Assign every indexed file to exactly one architecture part.
 *
 * When multiple declared parts match a file, the most specific pattern wins
 * (most literal leading path segments, then longest pattern). A tie goes to
 * the part listed first and is recorded in `tieWarnings`. Files matching no
 * declared part are assigned to their fallback part and reported in
 * `unassignedFiles`.
 */
export function assignFilesToParts(
  architecture: ArchitectureFile,
  filePaths: readonly string[],
  options: AssignFilesOptions = {},
): ArchitectureAssignment {
  const uniqueFiles = new Set<string>();
  for (const raw of filePaths) {
    const normalized = normalizeFilePath(raw);
    if (normalized) uniqueFiles.add(normalized);
  }
  const sortedFiles = [...uniqueFiles].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  const compiledDeclared = compileParts(architecture.parts);
  const compiledFallback = options.fallback
    ? compileParts(options.fallback.parts)
    : [];

  const declaredFiles = new Map<string, string[]>();
  const usedIds = new Set<string>();
  for (const part of architecture.parts) {
    declaredFiles.set(part.id, []);
    usedIds.add(part.id);
  }

  const fallbackPartsByKey = new Map<string, AssignedArchitecturePart>();
  const fileToPart: Record<string, string> = {};
  const unassignedFiles: string[] = [];
  const tieWarnings: ArchitectureTieWarning[] = [];

  for (const filePath of sortedFiles) {
    const winners = findWinningMatches(compiledDeclared, filePath);
    if (winners.length > 0) {
      const winner = winners[0]!;
      declaredFiles.get(winner.part.id)!.push(filePath);
      fileToPart[filePath] = winner.part.id;
      if (winners.length > 1) {
        tieWarnings.push({
          path: filePath,
          winnerPartId: winner.part.id,
          tiedPartIds: winners.map((entry) => entry.part.id),
          patterns: winners.map((entry) => entry.pattern.pattern),
        });
      }
      continue;
    }

    unassignedFiles.push(filePath);

    const fallbackWinners = findWinningMatches(compiledFallback, filePath);
    let key: string;
    let template: ArchitecturePart;
    if (fallbackWinners.length > 0) {
      template = fallbackWinners[0]!.part;
      key = `fallback:${template.id}`;
    } else {
      ({ key, template } = synthesizeFolderPart(filePath));
    }

    let fallbackPart = fallbackPartsByKey.get(key);
    if (!fallbackPart) {
      const id = allocateFallbackId(template.id, usedIds);
      fallbackPart = {
        ...template,
        id,
        paths: [...template.paths],
        files: [],
        fallback: true,
      };
      fallbackPartsByKey.set(key, fallbackPart);
    }
    fallbackPart.files.push(filePath);
    fileToPart[filePath] = fallbackPart.id;
  }

  const declaredAssigned: AssignedArchitecturePart[] = architecture.parts.map(
    (part) => ({
      ...part,
      paths: [...part.paths],
      files: declaredFiles.get(part.id)!,
    }),
  );

  const fallbackAssigned = [...fallbackPartsByKey.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  return {
    parts: [...declaredAssigned, ...fallbackAssigned],
    fileToPart,
    unassignedFiles,
    tieWarnings,
  };
}
