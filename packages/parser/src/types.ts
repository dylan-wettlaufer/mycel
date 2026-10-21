import type { Diagnostic, SourceRange } from "@mycel/shared";

export type SymbolKind = "function" | "class" | "method";

export interface ParsedSymbol {
  /** File-local identity based on path, kind, lexical name, and duplicate ordinal. */
  id: string;
  kind: SymbolKind;
  name: string;
  qualifiedName: string;
  parentId: string;
  range: SourceRange;
  signatureRanges: SourceRange[];
  implementationRange?: SourceRange;
  isStatic: boolean;
  methodKind?: "method" | "get" | "set" | "constructor";
}

export interface ImportBinding {
  kind: "default" | "named" | "namespace";
  imported: string;
  local: string;
  typeOnly: boolean;
}

export interface ParsedImport {
  specifier: string;
  bindings: ImportBinding[];
  typeOnly: boolean;
  range: SourceRange;
}

export interface ParsedExport {
  kind: "named" | "default" | "all" | "namespace";
  name: string;
  localName?: string;
  specifier?: string;
  typeOnly: boolean;
  range: SourceRange;
}

export interface CallSite {
  kind: "call" | "construct";
  callee: string;
  range: SourceRange;
  calleeRange: SourceRange;
  /** Absent for calls outside a callable body, such as module initialization. */
  callerId?: string;
}

export interface ParseResult {
  path: string;
  language: "typescript" | "tsx";
  fileId: string;
  status: "parsed" | "partial";
  symbols: ParsedSymbol[];
  contains: { parentId: string; childId: string }[];
  imports: ParsedImport[];
  exports: ParsedExport[];
  calls: CallSite[];
  diagnostics: Diagnostic[];
}
