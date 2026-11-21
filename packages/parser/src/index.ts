import { sourceExtensions, sourceLanguageForPath } from "@mycel/shared";
import Parser from "tree-sitter";
import python from "tree-sitter-python";
import typescript from "tree-sitter-typescript";
import { extract, extractSyntaxDiagnostics } from "./extract.js";
import { extractPythonImports } from "./python.js";
import type { ParseResult } from "./types.js";

const grammars = { ...typescript, python };

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
  const language = sourceLanguageForPath(path);
  if (!language)
    throw new RangeError(
      `parseFile supports ${sourceExtensions.join(", ")} files only`,
    );
  const parser = new Parser();
  parser.setLanguage(grammars[language]);
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
  if (language === "python") extractPythonImports(tree.rootNode, result);
  else extract(tree.rootNode, result);
  return result;
}
