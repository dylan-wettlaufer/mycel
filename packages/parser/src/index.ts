import Parser from "tree-sitter";
import languages from "tree-sitter-typescript";
import { extract, extractSyntaxDiagnostics } from "./extract.js";
import type { ParseResult } from "./types.js";

export type {
  CallSite,
  ImportBinding,
  ParsedExport,
  ParsedImport,
  ParsedSymbol,
  ParseResult,
  SymbolKind,
} from "./types.js";

/** Parse supplied source only. Module/call resolution belongs to @mycel/core. */
export function parseFile(path: string, source: string): ParseResult {
  if (typeof path !== "string" || typeof source !== "string") {
    throw new TypeError("parseFile expects a path and source string");
  }
  if (!/\.(ts|tsx)$/.test(path)) {
    throw new RangeError("parseFile supports .ts and .tsx files only");
  }
  const language = path.endsWith(".tsx") ? "tsx" : "typescript";
  const parser = new Parser();
  parser.setLanguage(languages[language]);
  // The native binding owns tree memory through GC; no AST escapes this call.
  // Bound each read: the binding's default string reader fails on large inputs.
  const tree = parser.parse((offset) => source.slice(offset, offset + 4096));
  const result: ParseResult = {
    path,
    language,
    fileId: `file:${encodeURIComponent(path)}`,
    status: tree.rootNode.hasError ? "partial" : "parsed",
    symbols: [],
    contains: [],
    imports: [],
    exports: [],
    calls: [],
    diagnostics: [],
  };
  extractSyntaxDiagnostics(tree.rootNode, result);
  extract(tree.rootNode, result);
  return result;
}
