import type {
  ArchitectureConnectionEvidence,
  ArchitectureConnectionWithChanges,
  ArchitectureGitChanges,
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
  for (const connection of connections) {
    const { sourcePartId, targetPartId, count } = connection;
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
    strongest: rows[0]?.count ?? 0,
  };
}

export function rankEntryPoints(
  partId: string,
  connections: readonly ArchitectureConnectionWithChanges[],
) {
  const byFile = new Map<
    string,
    { path: string; sources: Set<string>; links: number }
  >();
  for (const { targetPartId, sourcePartId, evidence } of connections) {
    if (targetPartId !== partId) continue;
    for (const { targetFile } of evidence) {
      const entry = byFile.get(targetFile) ?? {
        path: targetFile,
        sources: new Set(),
        links: 0,
      };
      entry.sources.add(sourcePartId);
      entry.links++;
      byFile.set(targetFile, entry);
    }
  }
  return [...byFile.values()]
    .map(({ path, sources, links }) => ({ path, parts: sources.size, links }))
    .sort(
      (a, b) =>
        b.links - a.links || b.parts - a.parts || a.path.localeCompare(b.path),
    );
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
