import type { SourceRange } from "@mycel/shared";
import type Parser from "tree-sitter";

export type SyntaxNode = Parser.SyntaxNode;

export function sourceRange(node: SyntaxNode): SourceRange {
  return {
    start: node.startIndex,
    end: node.endIndex,
    startLine: node.startPosition.row + 1,
    startColumn: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1,
  };
}

export function hasToken(node: SyntaxNode, token: string): boolean {
  return node.children.some((child) => child.type === token);
}

/** Decode quoted module specifiers and string-named bindings without executing code. */
export function nameText(node: SyntaxNode): string {
  if (node.type !== "string") return node.text;
  return node.text
    .slice(1, -1)
    .replace(
      /\\(u\{[\da-fA-F]+\}|u[\da-fA-F]{4}|x[\da-fA-F]{2}|\r\n|[\s\S])/g,
      (_match: string, escape: string) => {
        if (escape.startsWith("u{") && escape.endsWith("}")) {
          const point = Number.parseInt(escape.slice(2, -1), 16);
          return point <= 0x10ffff
            ? String.fromCodePoint(point)
            : `\\${escape}`;
        }
        if (/^[ux][\da-fA-F]+$/.test(escape)) {
          return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
        }
        const escapes: Record<string, string> = {
          n: "\n",
          r: "\r",
          t: "\t",
          b: "\b",
          f: "\f",
          v: "\v",
          "0": "\0",
          "\n": "",
          "\r": "",
          "\r\n": "",
        };
        return escapes[escape] ?? escape;
      },
    );
}

/** Read identifiers from bindings, ignoring property keys and default values. */
export function bindingNames(node: SyntaxNode): string[] {
  const names: string[] = [];
  const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    if (!current) break;
    switch (current.type) {
      case "identifier":
      case "shorthand_property_identifier_pattern":
        names.push(current.text);
        break;
      case "pair_pattern": {
        const value = current.childForFieldName("value");
        if (value) stack.push(value);
        break;
      }
      case "assignment_pattern":
      case "object_assignment_pattern": {
        const left = current.childForFieldName("left");
        if (left) stack.push(left);
        break;
      }
      case "rest_pattern":
      case "object_pattern":
      case "array_pattern":
        stack.push(...current.namedChildren.reverse());
        break;
      default:
        break;
    }
  }
  return names;
}
