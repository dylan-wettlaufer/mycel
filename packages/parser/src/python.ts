import { sourceRange } from "./syntax.js";
import type { SyntaxNode } from "./syntax.js";
import type { ParseResult } from "./types.js";

function moduleName(node: SyntaxNode): string {
  if (node.type === "relative_import") {
    const prefix = node.namedChildren.find(
      (child) => child.type === "import_prefix",
    );
    const name = node.namedChildren.find(
      (child) => child.type === "dotted_name",
    );
    return (
      ".".repeat(
        prefix?.children.filter((child) => child.type === ".").length ?? 0,
      ) + (name ? moduleName(name) : "")
    );
  }
  return node.namedChildren
    .filter((child) => child.type === "identifier")
    .map((child) => child.text)
    .join(".");
}

export function extractPythonImports(
  root: SyntaxNode,
  result: ParseResult,
): void {
  for (const node of root.namedChildren) {
    if (
      node.type !== "import_statement" &&
      node.type !== "import_from_statement"
    )
      continue;
    const names = node.childrenForFieldName("name");
    const common = { typeOnly: false, range: sourceRange(node) };
    if (node.type === "import_statement") {
      for (const name of names) {
        const target =
          name.type === "aliased_import"
            ? name.childForFieldName("name")
            : name;
        const specifier = target && moduleName(target);
        if (specifier)
          result.imports.push({ ...common, specifier, bindings: [] });
      }
      continue;
    }

    const target = node.childForFieldName("module_name");
    const specifier = target && moduleName(target);
    if (!specifier) continue;
    result.imports.push({
      ...common,
      specifier,
      bindings: names.flatMap((name) => {
        const aliased = name.type === "aliased_import";
        const target = aliased ? name.childForFieldName("name") : name;
        const imported = target && moduleName(target);
        if (!imported) return [];
        const local =
          (aliased && name.childForFieldName("alias")?.text) || imported;
        return [{ kind: "named", imported, local, typeOnly: false }];
      }),
    });
  }
}
