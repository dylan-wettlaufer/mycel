import type {
  ArchitectureConnectionEvidence,
  ArchitectureConnectionWithChanges,
  ArchitectureGitChanges,
  ArchitectureMap,
  ArchitecturePartWithChanges,
} from "@mycel/shared";

export interface PartConnectionRow {
  partId: string;
  uses?: ArchitectureConnectionWithChanges;
  usedBy?: ArchitectureConnectionWithChanges;
  count: number;
}

export function groupPartConnections(
  partId: string,
  connections: readonly ArchitectureConnectionWithChanges[],
) {
  const byPart = new Map<string, PartConnectionRow>();
  const mapTotals = new Map<string, number>();
  let strongest = 0;
  for (const connection of connections) {
    const { sourcePartId, targetPartId, count } = connection;
    // A reciprocal row combines both directions, so use pair totals for the map scale too.
    const pairId = [sourcePartId, targetPartId].sort().join("\0");
    const total = (mapTotals.get(pairId) ?? 0) + count;
    mapTotals.set(pairId, total);
    strongest = Math.max(strongest, total);
    if (sourcePartId !== partId && targetPartId !== partId) continue;
    const outgoing = sourcePartId === partId;
    const otherId = outgoing ? targetPartId : sourcePartId;
    const row = byPart.get(otherId) ?? { partId: otherId, count: 0 };
    row[outgoing ? "uses" : "usedBy"] = connection;
    row.count += count;
    byPart.set(otherId, row);
  }
  const rows = [...byPart.values()].sort(
    (a, b) => b.count - a.count || a.partId.localeCompare(b.partId),
  );
  return {
    twoWay: rows.filter((row) => row.uses && row.usedBy),
    uses: rows.filter((row) => row.uses && !row.usedBy),
    usedBy: rows.filter((row) => row.usedBy && !row.uses),
    strongest,
  };
}

const smallPartFileLimit = 8;

export function entryPointsForComponent(map: ArchitectureMap) {
  const external = new Map(
    map.parts.filter((part) => part.boundary).map((part) => [part.id, part]),
  );
  const entries = new Map<
    string,
    { path: string; symbol: string; callers: Set<string>; priority: number }
  >();
  for (const connection of map.connections) {
    const caller = external.get(connection.sourcePartId);
    if (!caller) continue;
    const priority =
      caller.kind === "app" || caller.kind === "service"
        ? 2
        : caller.kind === "cli"
          ? 1
          : 0;
    for (const { kind, targetFile, symbol } of connection.evidence) {
      if (kind !== "call" || !symbol) continue;
      const key = JSON.stringify([targetFile, symbol]);
      const entry = entries.get(key) ?? {
        path: targetFile,
        symbol,
        callers: new Set<string>(),
        priority,
      };
      entry.callers.add(caller.name);
      entry.priority = Math.max(entry.priority, priority);
      entries.set(key, entry);
    }
  }
  const ranked = [...entries.entries()].sort(
    ([, a], [, b]) =>
      b.priority - a.priority ||
      b.callers.size - a.callers.size ||
      a.symbol.localeCompare(b.symbol),
  );
  return ranked[0]?.[1].priority
    ? ranked.filter(([, entry]) => entry.priority > 0)
    : ranked;
}

export function entryPointsForPart(
  part: Pick<ArchitecturePartWithChanges, "id" | "files">,
  connections: readonly ArchitectureConnectionWithChanges[],
  showSmallPartEntries = false,
) {
  const byFile = new Map<
    string,
    { path: string; callers: Map<string, Set<string>>; links: number }
  >();
  for (const { targetPartId, sourcePartId, evidence } of connections) {
    if (targetPartId !== part.id) continue;
    for (const { targetFile, kind, symbol } of evidence) {
      const entry = byFile.get(targetFile) ?? {
        path: targetFile,
        callers: new Map(),
        links: 0,
      };
      const symbols = entry.callers.get(sourcePartId) ?? new Set<string>();
      if (kind === "call" && symbol) symbols.add(symbol);
      entry.callers.set(sourcePartId, symbols);
      entry.links++;
      byFile.set(targetFile, entry);
    }
  }
  const entries = [...byFile.values()];
  if (
    !showSmallPartEntries &&
    part.files.length <= smallPartFileLimit &&
    entries.every(({ links }) => links === 1)
  ) {
    return [];
  }
  return entries
    .sort(
      (a, b) =>
        b.links - a.links ||
        b.callers.size - a.callers.size ||
        a.path.localeCompare(b.path),
    )
    .map(({ path, callers, links }) => ({
      path,
      links,
      callers: [...callers].map(([partId, symbols]) => ({
        partId,
        symbols: [...symbols].sort(),
      })),
    }));
}

export function describeChangePeriod(changes: ArchitectureGitChanges) {
  switch (changes.resolvedWindow) {
    case "uncommitted":
      return "working tree";
    case "branch":
      return changes.baseRef
        ? `since branching from ${changes.baseRef}`
        : "this branch";
    case "30d":
      return "last 30 days";
    case "7d":
      return "last 7 days";
  }
}

export function splitFilePath(path: string) {
  const slash = path.lastIndexOf("/");
  return {
    folder: path.slice(0, Math.max(slash, 0)),
    name: path.slice(slash + 1),
  };
}

export function groupPartFiles(
  paths: readonly string[],
  changes: ArchitectureGitChanges,
) {
  const added = new Set(changes.addedFiles);
  const edited = new Set(changes.modifiedFiles);
  const uncommitted = new Set(changes.uncommittedFiles);
  const byFolder = new Map<
    string,
    {
      path: string;
      name: string;
      status: "new" | "edited" | null;
      uncommitted: boolean;
    }[]
  >();
  for (const path of paths) {
    const { folder, name } = splitFilePath(path);
    const files = byFolder.get(folder) ?? [];
    files.push({
      path,
      name,
      status: added.has(path) ? "new" : edited.has(path) ? "edited" : null,
      uncommitted: uncommitted.has(path),
    });
    byFolder.set(folder, files);
  }
  const changed = (file: { status: string | null; uncommitted: boolean }) =>
    Boolean(file.status || file.uncommitted);
  return [...byFolder]
    .map(([folder, files]) => ({
      folder,
      files: files.sort(
        (a, b) =>
          Number(changed(b)) - Number(changed(a)) ||
          a.name.localeCompare(b.name),
      ),
      changedCount: files.filter(changed).length,
    }))
    .sort(
      (a, b) =>
        Number(b.changedCount > 0) - Number(a.changedCount > 0) ||
        a.folder.localeCompare(b.folder),
    );
}

export function groupConnectionEvidence(
  evidence: readonly ArchitectureConnectionEvidence[],
) {
  const bySource = new Map<string, ArchitectureConnectionEvidence[]>();
  for (const item of evidence) {
    const items = bySource.get(item.file) ?? [];
    items.push(item);
    bySource.set(item.file, items);
  }
  return [...bySource].sort(([a], [b]) => a.localeCompare(b));
}
