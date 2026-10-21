import { bindingNames, hasToken, nameText, sourceRange } from "./syntax.js";
import type { SyntaxNode } from "./syntax.js";
import type { ParsedExport, ParsedImport } from "./types.js";

export function extractImport(node: SyntaxNode): ParsedImport | undefined {
  const requireClause = node.namedChildren.find(
    (child) => child.type === "import_require_clause",
  );
  const source =
    node.childForFieldName("source") ??
    requireClause?.childForFieldName("source");
  if (!source) return undefined;
  const typeOnly = hasToken(node, "type");
  const result: ParsedImport = {
    specifier: nameText(source),
    bindings: [],
    typeOnly,
    range: sourceRange(node),
  };
  if (requireClause) {
    const local = requireClause.namedChildren.find(
      (child) => child.type === "identifier",
    );
    if (local)
      result.bindings.push({
        kind: "namespace",
        imported: "*",
        local: local.text,
        typeOnly,
      });
  }
  const clause = node.namedChildren.find(
    (child) => child.type === "import_clause",
  );
  for (const child of clause?.namedChildren ?? []) {
    if (child.type === "identifier") {
      result.bindings.push({
        kind: "default",
        imported: "default",
        local: child.text,
        typeOnly,
      });
    } else if (child.type === "namespace_import") {
      const local = child.namedChildren.find(
        (part) => part.type === "identifier",
      );
      if (local)
        result.bindings.push({
          kind: "namespace",
          imported: "*",
          local: local.text,
          typeOnly,
        });
    } else if (child.type === "named_imports") {
      for (const binding of child.namedChildren) {
        if (binding.type !== "import_specifier") continue;
        const name = binding.childForFieldName("name");
        const alias = binding.childForFieldName("alias");
        if (name)
          result.bindings.push({
            kind: "named",
            imported: nameText(name),
            local: (alias ?? name).text,
            typeOnly: typeOnly || hasToken(binding, "type"),
          });
      }
    }
  }
  return result;
}

export function extractExports(node: SyntaxNode): ParsedExport[] {
  const source = node.childForFieldName("source");
  const common = {
    ...(source ? { specifier: nameText(source) } : {}),
    typeOnly: hasToken(node, "type"),
    range: sourceRange(node),
  };
  let declaration = node.childForFieldName("declaration");
  if (declaration?.type === "ambient_declaration") {
    declaration =
      declaration.namedChildren.find((child) => child.type !== "comment") ??
      null;
  }
  const value = node.childForFieldName("value");
  if (hasToken(node, "default")) {
    const name = declaration?.childForFieldName("name");
    return [
      {
        ...common,
        kind: "default",
        name: "default",
        ...(name
          ? { localName: nameText(name) }
          : value?.type === "identifier"
            ? { localName: value.text }
            : {}),
      },
    ];
  }
  const clause = node.namedChildren.find(
    (child) => child.type === "export_clause",
  );
  if (clause) {
    return clause.namedChildren.flatMap((binding): ParsedExport[] => {
      if (binding.type !== "export_specifier") return [];
      const name = binding.childForFieldName("name");
      const alias = binding.childForFieldName("alias");
      return name
        ? [
            {
              ...common,
              kind: "named",
              name: nameText(alias ?? name),
              localName: nameText(name),
              typeOnly: common.typeOnly || hasToken(binding, "type"),
            },
          ]
        : [];
    });
  }
  const namespace = node.namedChildren.find(
    (child) => child.type === "namespace_export",
  );
  if (namespace) {
    const name = namespace.namedChildren[0];
    return name ? [{ ...common, kind: "namespace", name: nameText(name) }] : [];
  }
  if (hasToken(node, "*")) return [{ ...common, kind: "all", name: "*" }];
  if (!declaration) return [];
  let names: string[];
  if (
    declaration.type === "lexical_declaration" ||
    declaration.type === "variable_declaration"
  ) {
    names = declaration.namedChildren.flatMap((child) => {
      const name =
        child.type === "variable_declarator"
          ? child.childForFieldName("name")
          : null;
      return name ? bindingNames(name) : [];
    });
  } else {
    const name = declaration.childForFieldName("name");
    names = name ? [nameText(name)] : [];
  }
  return names.map((name) => ({
    ...common,
    kind: "named",
    name,
    localName: name,
    typeOnly:
      common.typeOnly ||
      declaration.type === "interface_declaration" ||
      declaration.type === "type_alias_declaration",
  }));
}
