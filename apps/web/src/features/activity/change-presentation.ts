import type {
  ArchitectureMap,
  ChangeAction,
  ChangeEvent,
  FileChangeSummary,
} from "@mycel/shared";
import { eventNode } from "./event-node";
import {
  relationshipPartNames,
  relationshipTitle,
} from "./relationship-change";

const actions: Record<ChangeAction, string> = {
  created: "Added",
  modified: "Edited",
  deleted: "Removed",
};

export function changeTitle(
  event: ChangeEvent,
  architecture?: ArchitectureMap,
) {
  if (event.relationship) {
    return relationshipTitle(
      event.relationship,
      event.action === "deleted" ? "deleted" : "created",
      relationshipPartNames(architecture, event.id, event.relationship),
    );
  }
  const name = event.path.split("/").at(-1);
  const node = eventNode(event);
  if (node)
    return `${actions[event.action]} ${node.kind === "file" ? name : node.qualifiedName}`;
  const kind = (event.after ?? event.before)?.kind;
  const relationship =
    kind === "IMPORTS" ? "import" : kind === "CALLS" ? "call" : "connection";
  return `${actions[event.action]} ${relationship} in ${name}`;
}

export function relationshipCountText(summary: FileChangeSummary) {
  return [
    [summary.addedCalls, "call", "added"],
    [summary.removedCalls, "call", "removed"],
    [summary.addedImports, "import", "added"],
    [summary.removedImports, "import", "removed"],
  ].flatMap(([count, noun, action]) =>
    count ? [`${count} ${noun}${count === 1 ? "" : "s"} ${action}`] : [],
  );
}

export function fileChangePreview(summary: FileChangeSummary) {
  const names = summary.symbols
    .slice(0, 2)
    .map(({ name, action }) => `${actions[action]} ${name}`);
  const other = summary.symbolCount - names.length;
  return (
    [
      ...names,
      ...(other > 0 ? [`+${other} more`] : []),
      ...relationshipCountText(summary),
    ].join(" · ") || "Source edited"
  );
}
