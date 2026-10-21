import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseFile } from "../dist/index.js";

const fixture = (name) =>
  readFile(new URL(`fixtures/${name}.txt`, import.meta.url), "utf8");
const symbolNamed = (result, name) => {
  const symbol = result.symbols.find((item) => item.qualifiedName === name);
  assert.ok(symbol, `Missing symbol: ${name}`);
  return symbol;
};

test("extracts lexical symbols, callable bindings, classes, and containment", async () => {
  const source = await fixture("symbols.ts");
  const result = parseFile("src/symbols.ts", source);
  assert.equal(result.language, "typescript");
  assert.equal(result.status, "parsed");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.symbols.map((symbol) => symbol.qualifiedName),
    [
      "load",
      "load.normalize",
      "load.finish",
      "Store",
      "Store.constructor",
      "Store.value",
      "Store.value",
      "Store.open",
      "Store.save",
      "Store.update",
      "handlers.onSave",
      "handlers.onClose",
      "wrapped",
      "Box",
      "Box.render",
      "$callback1",
      "Utilities.format",
      "Base",
      "Base.execute",
    ],
  );
  const load = symbolNamed(result, "load");
  assert.equal(load.signatureRanges.length, 2);
  assert.match(
    source.slice(load.implementationRange.start, load.implementationRange.end),
    /^function load/,
  );
  assert.equal(symbolNamed(result, "load.finish").kind, "function");
  assert.equal(symbolNamed(result, "load.normalize").parentId, load.id);
  assert.equal(symbolNamed(result, "Store.save").kind, "method");
  assert.equal(symbolNamed(result, "Store.open").isStatic, true);
  assert.equal(symbolNamed(result, "Store.update").signatureRanges.length, 1);
  const accessors = result.symbols.filter(
    (symbol) => symbol.qualifiedName === "Store.value",
  );
  assert.deepEqual(
    accessors.map((symbol) => symbol.methodKind),
    ["get", "set"],
  );
  assert.notEqual(accessors[0].id, accessors[1].id);
  assert.equal(
    symbolNamed(result, "Base.execute").implementationRange,
    undefined,
  );
  assert.equal(symbolNamed(result, "Base.execute").signatureRanges.length, 1);
  assert.equal(
    symbolNamed(result, "Box.render").parentId,
    symbolNamed(result, "Box").id,
  );
  assert.deepEqual(
    result.contains,
    result.symbols.map((symbol) => ({
      parentId: symbol.parentId,
      childId: symbol.id,
    })),
  );
});

test("extracts module bindings, type-only distinctions, and every supported export form", async () => {
  const result = parseFile("modules.ts", await fixture("modules.ts"));
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.imports[0].bindings, [
    { kind: "default", imported: "default", local: "Default", typeOnly: false },
    { kind: "named", imported: "original", local: "renamed", typeOnly: false },
    { kind: "named", imported: "Shape", local: "Shape", typeOnly: true },
    { kind: "named", imported: "Mode", local: "LocalMode", typeOnly: true },
  ]);
  assert.deepEqual(
    result.imports.map((item) => [item.specifier, item.typeOnly]),
    [
      ["./model", false],
      ["./utilities", false],
      ["./types", true],
      ["./types", true],
      ["./side-effect", false],
      ["./legacy", false],
      ["./model", false],
    ],
  );
  assert.equal(result.imports[1].bindings[0].kind, "namespace");
  assert.equal(result.imports[2].bindings[0].typeOnly, true);
  assert.deepEqual(result.imports[4].bindings, []);
  assert.equal(result.imports[5].bindings[0].local, "legacy");
  assert.deepEqual(
    result.exports.map((item) => [
      item.kind,
      item.name,
      item.localName,
      item.specifier,
      item.typeOnly,
    ]),
    [
      ["named", "renamed", "renamed", undefined, false],
      ["named", "publicName", "renamed", undefined, false],
      ["named", "Shape", "Shape", undefined, true],
      ["named", "forwarded", "external", "./remote", false],
      ["named", "Remote", "Remote", "./remote", true],
      ["named", "PublicType", "OnlyType", "./types", true],
      ["all", "*", undefined, "./all", false],
      ["namespace", "namespace", undefined, "./namespace", false],
      ...["first", "alias", "fallback", "rest", "head", "tail"].map((name) => [
        "named",
        name,
        name,
        undefined,
        false,
      ]),
      ["named", "PublicShape", "PublicShape", undefined, true],
      ["named", "PublicAlias", "PublicAlias", undefined, true],
      ["named", "declared", "declared", undefined, false],
      ["named", "declaredValue", "declaredValue", undefined, false],
      ["default", "default", "renamed", undefined, false],
    ],
  );
});

test("parses TSX with fragments, attributes, expression calls, and nested callbacks", async () => {
  const source = await fixture("component.tsx");
  const result = parseFile("ui/Panel.tsx", source);
  assert.equal(result.language, "tsx");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.symbols.map((symbol) => symbol.qualifiedName),
    ["Panel", "Panel.onClick", "Panel.$callback1", "default"],
  );
  assert.deepEqual(
    result.calls.map((call) => [
      call.callee,
      result.symbols.find((symbol) => symbol.id === call.callerId)
        ?.qualifiedName,
    ]),
    [
      ["track", "Panel.onClick"],
      ["format", "Panel"],
      ["items.map", "Panel"],
      ["render", "Panel.$callback1"],
      ["timestamp", "default"],
    ],
  );
  assert.deepEqual(
    result.exports.map((item) => [item.kind, item.name]),
    [
      ["named", "Panel"],
      ["default", "default"],
    ],
  );
});

test("records calls without resolving them and assigns the nearest callable", () => {
  const source = `boot();
function outer(value = defaultValue()) {
  function inner() { service?.save?.(); }
  const callback = () => factory()();
  class Local extends base() {
    field = fieldValue();
    constructor() { super(); }
    method() { this.run(); }
    [computed()]() { inside(); }
  }
  inner(); new Local(); handlers[key](); import('./lazy');
}
`;
  const result = parseFile("calls.ts", source);
  assert.deepEqual(result.diagnostics, []);
  const caller = (call) =>
    result.symbols.find((symbol) => symbol.id === call.callerId)?.qualifiedName;
  assert.deepEqual(
    result.calls.map((call) => [call.callee, caller(call)]),
    [
      ["boot", undefined],
      ["defaultValue", "outer"],
      ["service?.save", "outer.inner"],
      ["factory()", "outer.callback"],
      ["factory", "outer.callback"],
      ["base", "outer"],
      ["fieldValue", undefined],
      ["super", "outer.Local.constructor"],
      ["this.run", "outer.Local.method"],
      ["computed", undefined],
      ["inside", "outer.Local.[computed()]"],
      ["inner", "outer"],
      ["Local", "outer"],
      ["handlers[key]", "outer"],
      ["import", "outer"],
    ],
  );
  assert.equal(
    result.calls.find((call) => call.callee === "Local").kind,
    "construct",
  );
  for (const call of result.calls)
    assert.equal(
      source.slice(call.calleeRange.start, call.calleeRange.end),
      call.callee,
    );
});

test("ranges preserve UTF-16 offsets, Unicode columns, CRLF, and exact source slices", () => {
  const source =
    '// 🙂\r\nconst text = "🙂"; function café() { return other("🙂"); }\r\n';
  const result = parseFile("unicode.ts", source);
  const symbol = symbolNamed(result, "café");
  assert.equal(
    source.slice(symbol.range.start, symbol.range.end),
    'function café() { return other("🙂"); }',
  );
  const ranges = [
    ...result.symbols.map((symbol) => symbol.range),
    ...result.calls.flatMap((call) => [call.range, call.calleeRange]),
  ];
  for (const range of ranges) {
    for (const endpoint of ["start", "end"]) {
      const before = source.slice(0, range[endpoint]).split("\n");
      assert.equal(range[`${endpoint}Line`], before.length);
      assert.equal(range[`${endpoint}Column`], before.at(-1).length + 1);
    }
  }
});

test("keeps deterministic identities through line shifts and distinguishes scopes and duplicates", () => {
  const source = `function same() {} function same() {}
class C { static run(){} run(){} }
{ function scoped(){} } { function scoped(){} }
namespace A { function nested(){} } namespace B { function nested(){} }
`;
  const result = parseFile("identity.ts", source);
  assert.deepEqual(result, parseFile("identity.ts", source));
  assert.deepEqual(
    result.symbols.map((symbol) => symbol.id),
    parseFile("identity.ts", `// moved\n\n${source}`).symbols.map(
      (symbol) => symbol.id,
    ),
  );
  assert.equal(
    new Set(result.symbols.map((symbol) => symbol.id)).size,
    result.symbols.length,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "duplicate-symbol");
  assert.ok(
    result.symbols.some((symbol) => symbol.qualifiedName === "A.nested"),
  );
  assert.ok(
    result.symbols.some((symbol) => symbol.qualifiedName === "B.nested"),
  );
});

test("recovers useful structure and ranged diagnostics from errors and missing tokens", () => {
  for (const [path, source] of [
    ["broken.ts", "function good(){ work(); }\nconst broken = ;"],
    ["missing.ts", "function unfinished() { work()"],
    ["broken.tsx", "export const View = () => <div>{format(</div>;"],
    ["type.ts", "type Broken = { value: }; function good(){}"],
  ]) {
    const result = parseFile(path, source);
    assert.equal(result.status, "partial", path);
    assert.ok(result.diagnostics.length, path);
    for (const diagnostic of result.diagnostics) {
      assert.equal(diagnostic.path, path);
      assert.equal(diagnostic.source, "parser");
      assert.ok(diagnostic.range.start >= 0);
      assert.ok(diagnostic.range.end <= source.length);
    }
  }
  const recovered = parseFile(
    "broken.ts",
    "function good(){ work(); }\nconst broken = ;",
  );
  assert.ok(symbolNamed(recovered, "good"));
  assert.equal(recovered.calls[0].callerId, recovered.symbols[0].id);
  assert.ok(
    parseFile("missing.ts", "function unfinished() { work()").diagnostics.some(
      (item) => item.code === "missing-syntax",
    ),
  );
});

test("supports anonymous/named default exports, generators, and declaration-only files", () => {
  for (const source of [
    "export default function() {}",
    "export default (() => 1)",
    "export default class {}",
  ]) {
    assert.equal(parseFile("default.ts", source).symbols[0].name, "default");
  }
  const named = parseFile("default.ts", "export default function named() {}");
  assert.equal(named.symbols[0].name, "named");
  assert.equal(named.exports[0].localName, "named");
  const generators = parseFile(
    "generator.ts",
    "function* values(){ yield get(); } const iterator = function*(){ yield next(); };",
  );
  assert.deepEqual(
    generators.symbols.map((item) => item.name),
    ["values", "iterator"],
  );
  assert.deepEqual(generators.diagnostics, []);
  const declarations = parseFile(
    "types.d.ts",
    "export declare function declared(): void; declare class C { method(): void; }",
  );
  assert.deepEqual(
    declarations.symbols.map((item) => item.qualifiedName),
    ["declared", "C", "C.method"],
  );
  assert.ok(declarations.symbols[0].signatureRanges.length);
});

test("keeps namespace and ambient-module exports separate from file exports", () => {
  const result = parseFile(
    "namespaces.ts",
    `
    export namespace Public { export function inside() {} }
    namespace Private { export function hidden() {} }
    declare module "external" {
      import type { Dependency } from "dependency";
      export function ambient(): void;
    }
  `,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.exports.map((item) => item.name),
    ["Public"],
  );
  assert.deepEqual(result.imports, []);
  assert.ok(symbolNamed(result, "Public.inside"));
  assert.ok(symbolNamed(result, "Private.hidden"));
});

test("groups overloads independently for duplicate callable groups", () => {
  const result = parseFile(
    "overloads.ts",
    `
    function convert(value: string): string;
    function convert(value: string) { return value; }
    function convert(value: number): number;
    function convert(value: number) { return value; }
  `,
  );
  assert.equal(result.symbols.length, 2);
  assert.ok(
    result.symbols.every(
      (symbol) =>
        symbol.signatureRanges.length === 1 && symbol.implementationRange,
    ),
  );
  assert.notEqual(result.symbols[0].id, result.symbols[1].id);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "duplicate-symbol");
});

test("accepts empty source and rejects unsupported extensions or invalid arguments explicitly", () => {
  const empty = parseFile("empty.ts", "");
  assert.equal(empty.status, "parsed");
  assert.deepEqual(empty.symbols, []);
  assert.deepEqual(empty.diagnostics, []);
  assert.throws(() => parseFile("file.js", ""), RangeError);
  assert.throws(() => parseFile("file.ts", null), TypeError);
  assert.throws(() => parseFile(null, ""), TypeError);
});

test("parses sources larger than the native input buffer without truncating", () => {
  const source = Array.from(
    { length: 2000 },
    (_, index) =>
      `export function task${index}(value: number) { return helper(value); }`,
  ).join("\n");
  assert.ok(source.length > 32 * 1024);
  const result = parseFile("large.ts", source);
  assert.equal(result.symbols.length, 2000);
  assert.equal(result.calls.length, 2000);
  assert.equal(result.exports.length, 2000);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.symbols.at(-1).name, "task1999");
  assert.equal(
    source.slice(
      result.calls.at(-1).range.start,
      result.calls.at(-1).range.end,
    ),
    "helper(value)",
  );
});
