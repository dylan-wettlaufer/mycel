import { hasToken, nameText, sourceRange } from "./syntax.js";
import type { SyntaxNode } from "./syntax.js";
import type { ParsedSymbol, SymbolKind } from "./types.js";

const callableTypes = new Set([
  "function_declaration",
  "generator_function_declaration",
  "function_expression",
  "generator_function",
  "arrow_function",
  "function_signature",
  "method_definition",
  "method_signature",
  "abstract_method_signature",
]);

export function isCallable(node: SyntaxNode): boolean {
  return callableTypes.has(node.type);
}

export function isClass(node: SyntaxNode): boolean {
  return (
    node.type === "class_declaration" ||
    node.type === "class" ||
    node.type === "abstract_class_declaration"
  );
}

/** Follow expression wrappers to discover the binding that owns a callable/object. */
export function outerExpression(node: SyntaxNode): SyntaxNode {
  let expression = node;
  while (
    expression.parent &&
    [
      "parenthesized_expression",
      "as_expression",
      "satisfies_expression",
      "non_null_expression",
      "type_assertion",
    ].includes(expression.parent.type)
  ) {
    expression = expression.parent;
  }
  return expression;
}

export function bindingOwner(node: SyntaxNode): SyntaxNode | null {
  const expression = outerExpression(node);
  const parent = expression.parent;
  return parent &&
    ["variable_declarator", "public_field_definition", "pair"].includes(
      parent.type,
    ) &&
    parent.childForFieldName("value")?.id === expression.id
    ? parent
    : null;
}

export function ownerName(owner: SyntaxNode): string | undefined {
  const name = owner.childForFieldName(owner.type === "pair" ? "key" : "name");
  if (!name || name.type === "object_pattern" || name.type === "array_pattern")
    return undefined;
  return nameText(name);
}

export interface SymbolDescription {
  kind: SymbolKind;
  name?: string;
  isStatic: boolean;
  methodKind?: ParsedSymbol["methodKind"];
  rangeNode: SyntaxNode;
}

export function describeSymbol(
  node: SyntaxNode,
): SymbolDescription | undefined {
  if (!isCallable(node) && !isClass(node)) return undefined;
  const owner = bindingOwner(node);
  const isMethod =
    !isClass(node) &&
    (node.type.includes("method") ||
      owner?.type === "public_field_definition" ||
      owner?.type === "pair");
  const kind: SymbolKind = isClass(node)
    ? "class"
    : isMethod
      ? "method"
      : "function";
  const name = node.childForFieldName("name");
  const boundName = owner ? ownerName(owner) : undefined;
  const outer = outerExpression(node).parent;
  const defaultExport =
    outer?.type === "export_statement" && hasToken(outer, "default");
  const methodKind = isMethod
    ? hasToken(node, "get")
      ? "get"
      : hasToken(node, "set")
        ? "set"
        : name?.text === "constructor" && node.parent?.type === "class_body"
          ? "constructor"
          : "method"
    : undefined;
  return {
    kind,
    ...(boundName
      ? { name: boundName }
      : name
        ? { name: nameText(name) }
        : defaultExport
          ? { name: "default" }
          : {}),
    isStatic: hasToken(owner ?? node, "static"),
    ...(methodKind ? { methodKind } : {}),
    rangeNode: owner ?? node,
  };
}

/** Only neighboring signatures can share a symbol with an implementation. */
export function previousDeclaration(node: SyntaxNode): SyntaxNode | null {
  let statement = node;
  while (
    statement.parent &&
    ["export_statement", "ambient_declaration"].includes(statement.parent.type)
  )
    statement = statement.parent;
  let previous = statement.previousNamedSibling;
  while (previous?.type === "comment") previous = previous.previousNamedSibling;
  while (
    previous &&
    ["export_statement", "ambient_declaration"].includes(previous.type)
  ) {
    previous =
      previous.childForFieldName("declaration") ??
      previous.namedChildren.find((child) => child.type !== "comment") ??
      null;
  }
  return previous;
}

export function extendOverload(symbol: ParsedSymbol, node: SyntaxNode): void {
  const range = sourceRange(node);
  symbol.range = {
    ...symbol.range,
    end: range.end,
    endLine: range.endLine,
    endColumn: range.endColumn,
  };
  if (node.childForFieldName("body")) symbol.implementationRange = range;
  else symbol.signatureRanges.push(range);
}
