import { extractExports, extractImport } from "./modules.js";
import {
  bindingOwner,
  describeSymbol,
  extendOverload,
  isCallable,
  isClass,
  ownerName,
  previousDeclaration,
} from "./symbols.js";
import { sourceRange } from "./syntax.js";
import type { SyntaxNode } from "./syntax.js";
import type { ParseResult, ParsedSymbol } from "./types.js";

interface Scope {
  name: string;
  parentId: string;
  callerId?: string;
}

const typeOnlyNodes = new Set([
  "type_annotation",
  "type_arguments",
  "type_parameters",
  "interface_declaration",
  "type_alias_declaration",
  "implements_clause",
]);

const qualify = (scope: string, name: string) =>
  scope ? `${scope}.${name}` : name;

export function extract(root: SyntaxNode, result: ParseResult): void {
  const counters = new Map<string, number>();
  const symbolsByNode = new Map<
    number,
    { symbol: ParsedSymbol; identity: string }
  >();
  const identities = new Map<string, number>();
  const nextName = (scope: string, category: string) => {
    const key = `${scope}:${category}`;
    const ordinal = (counters.get(key) ?? 0) + 1;
    counters.set(key, ordinal);
    return `$${category}${ordinal}`;
  };
  const stack: { node: SyntaxNode; scope: Scope }[] = [
    { node: root, scope: { name: "", parentId: result.fileId } },
  ];
  while (stack.length) {
    const entry = stack.pop();
    if (!entry) break;
    const { node, scope } = entry;
    if (typeOnlyNodes.has(node.type)) continue;
    const isFileLevel = node.parent?.type === "program";
    if (node.type === "import_statement" && isFileLevel) {
      const record = extractImport(node);
      if (record) result.imports.push(record);
    }
    if (node.type === "export_statement" && isFileLevel)
      result.exports.push(...extractExports(node));
    if (node.type === "call_expression" || node.type === "new_expression") {
      const callee = node.childForFieldName(
        node.type === "call_expression" ? "function" : "constructor",
      );
      if (callee)
        result.calls.push({
          kind: node.type === "call_expression" ? "call" : "construct",
          callee: callee.text,
          range: sourceRange(node),
          calleeRange: sourceRange(callee),
          ...(scope.callerId ? { callerId: scope.callerId } : {}),
        });
    }

    let childScope = scope;
    const description = describeSymbol(node);
    let symbol: ParsedSymbol | undefined;
    if (description) {
      const name =
        description.name ??
        nextName(
          scope.name,
          description.kind === "class" ? "class" : "callback",
        );
      const qualifiedName = qualify(scope.name, name);
      const identity = `${result.fileId}#${description.kind}:${encodeURIComponent(qualifiedName)}${description.isStatic ? ":static" : ""}${description.methodKind && description.methodKind !== "method" ? `:${description.methodKind}` : ""}`;
      const previous = previousDeclaration(node);
      const preceding = previous ? symbolsByNode.get(previous.id) : undefined;
      if (
        preceding &&
        preceding.identity === identity &&
        preceding.symbol.signatureRanges.length &&
        !preceding.symbol.implementationRange &&
        isCallable(node)
      ) {
        symbol = preceding.symbol;
        extendOverload(symbol, node);
      } else {
        const ordinal = (identities.get(identity) ?? 0) + 1;
        identities.set(identity, ordinal);
        const body = node.childForFieldName("body");
        symbol = {
          id: ordinal === 1 ? identity : `${identity}~${ordinal}`,
          kind: description.kind,
          name,
          qualifiedName,
          parentId: scope.parentId,
          range: sourceRange(description.rangeNode),
          signatureRanges: isCallable(node) && !body ? [sourceRange(node)] : [],
          ...(isCallable(node) && body
            ? { implementationRange: sourceRange(node) }
            : {}),
          isStatic: description.isStatic,
          ...(description.methodKind
            ? { methodKind: description.methodKind }
            : {}),
        };
        result.symbols.push(symbol);
        result.contains.push({ parentId: scope.parentId, childId: symbol.id });
        if (ordinal > 1)
          result.diagnostics.push({
            path: result.path,
            source: "parser",
            severity: "warning",
            code: "duplicate-symbol",
            message: `Duplicate ${symbol.kind}: ${qualifiedName}`,
            range: symbol.range,
          });
      }
      symbolsByNode.set(node.id, { symbol, identity });
      childScope = {
        name: qualifiedName,
        parentId: symbol.id,
        ...(isCallable(node) ? { callerId: symbol.id } : {}),
      };
    } else if (node.type === "internal_module" || node.type === "module") {
      const name = node.childForFieldName("name");
      if (name) childScope = { ...scope, name: qualify(scope.name, name.text) };
    } else if (node.type === "object") {
      const owner = bindingOwner(node);
      childScope = {
        ...scope,
        name: qualify(
          scope.name,
          (owner && ownerName(owner)) || nextName(scope.name, "object"),
        ),
      };
    } else if (node.type === "statement_block") {
      const parent = node.parent;
      if (
        parent &&
        !isCallable(parent) &&
        parent.type !== "internal_module" &&
        parent.type !== "module"
      ) {
        childScope = {
          ...scope,
          name: qualify(scope.name, nextName(scope.name, "block")),
        };
      }
    } else if (
      ["for_statement", "for_in_statement", "catch_clause"].includes(node.type)
    ) {
      childScope = {
        ...scope,
        name: qualify(scope.name, nextName(scope.name, "scope")),
      };
    }

    const body = node.childForFieldName("body");
    const parameters = node.childForFieldName("parameters");
    const children = node.namedChildren;
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index];
      if (!child) continue;
      // Names/decorators/heritage are evaluated outside the callable/class body.
      const useOwnScope =
        symbol && (isCallable(node) || isClass(node))
          ? child.id === body?.id || child.id === parameters?.id
          : true;
      stack.push({ node: child, scope: useOwnScope ? childScope : scope });
    }
  }
}

export function extractSyntaxDiagnostics(
  root: SyntaxNode,
  result: ParseResult,
): void {
  const cursor = root.walk();
  let done = false;
  while (!done) {
    const node = cursor.currentNode;
    if (node.isError || node.isMissing)
      result.diagnostics.push({
        path: result.path,
        source: "parser",
        severity: "error",
        code: node.isMissing ? "missing-syntax" : "syntax-error",
        message: node.isMissing
          ? `Expected ${node.type}`
          : "Unrecognized syntax",
        range: sourceRange(node),
      });
    if (cursor.gotoFirstChild()) continue;
    while (!cursor.gotoNextSibling()) {
      if (!cursor.gotoParent()) {
        done = true;
        break;
      }
    }
  }
}
