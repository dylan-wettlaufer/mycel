import type {
  ArchitectureMap,
  RecordedRelationship,
  RelationshipEndpoint,
  SourceRange,
} from "@mycel/shared";

export interface RelationshipPartNames {
  sourcePartName?: string;
  targetPartName?: string;
}

export function relationshipSymbol(
  endpoint: RelationshipEndpoint,
  call = false,
) {
  const callback = /^\$callback\d+$/;
  const parts = endpoint.qualifiedName.split(".");
  const firstCallback = parts.findIndex((part) => callback.test(part));
  const suffix = call ? "()" : "";
  if (firstCallback < 0) return `${endpoint.qualifiedName}${suffix}`;
  const owner =
    parts.slice(0, firstCallback).join(".") || endpoint.path.split("/").at(-1);
  const name = parts.at(-1)!;
  return callback.test(name)
    ? `Callback in ${owner}`
    : `${name}${suffix} in a callback in ${owner}`;
}

export function relationshipTitle(
  relationship: RecordedRelationship,
  action: "created" | "deleted",
  names?: RelationshipPartNames,
) {
  const { source, target, kind } = relationship;
  const caller =
    names?.sourcePartName ??
    (source.qualifiedName === source.path
      ? source.path.split("/").at(-1)
      : relationshipSymbol(source));
  const callee =
    names?.targetPartName ??
    (kind === "IMPORTS"
      ? target.path.split("/").at(-1)
      : relationshipSymbol(target, true));
  const verb = kind === "CALLS" ? "calls" : "imports";
  const via =
    kind === "CALLS" && names?.targetPartName
      ? ` through ${relationshipSymbol(target, true)}`
      : "";
  return `${caller} ${action === "created" ? "now" : "no longer"} ${verb} ${callee}${via}`;
}

export function relationshipPartNames(
  map: ArchitectureMap | undefined,
  id: string,
  relationship: RecordedRelationship,
): RelationshipPartNames | undefined {
  const change = map?.relationshipChanges?.find((item) => item.id === id);
  if (change) return change;
  const source = map?.parts.find((part) =>
    part.files.includes(relationship.source.path),
  );
  const target = map?.parts.find((part) =>
    part.files.includes(relationship.target.path),
  );
  return {
    ...(source && source !== target ? { sourcePartName: source.name } : {}),
    ...(target && source !== target ? { targetPartName: target.name } : {}),
  };
}

export function lineRange(startLine: number, endLine = startLine): SourceRange {
  return {
    start: 0,
    end: 0,
    startLine,
    startColumn: 1,
    endLine: endLine + 1,
    endColumn: 1,
  };
}
