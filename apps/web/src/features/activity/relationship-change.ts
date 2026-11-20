import type {
  ArchitectureMap,
  RecordedRelationship,
  SourceRange,
} from "@mycel/shared";

export interface RelationshipPartNames {
  sourcePartName?: string;
  targetPartName?: string;
}

export function relationshipTitle(
  relationship: RecordedRelationship,
  action: "created" | "deleted",
  names?: RelationshipPartNames,
) {
  const { source, target, kind } = relationship;
  const caller = names?.sourcePartName ?? source.qualifiedName;
  const callee = names?.targetPartName ?? target.qualifiedName;
  const verb = kind === "CALLS" ? "calls" : "imports";
  const via =
    kind === "CALLS" && names?.targetPartName
      ? ` through ${target.qualifiedName}()`
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
