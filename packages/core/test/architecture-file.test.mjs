import assert from "node:assert/strict";
import test from "node:test";
import { parseArchitectureFile } from "../dist/index.js";

const valid = {
  version: 1,
  source: "agent",
  generatedAt: "2026-11-18T21:30:00-05:00",
  parts: [
    {
      id: "indexer",
      name: "Indexing engine",
      purpose: "Parses source files and keeps the graph up to date.",
      kind: "library",
      paths: ["packages/core/**", "packages/parser/**"],
    },
    {
      id: "web",
      name: "Web app",
      purpose: "Browser UI for exploring the graph.",
      kind: "app",
      paths: ["apps/web/src/**"],
    },
  ],
};

function parse(value) {
  return parseArchitectureFile(JSON.stringify(value));
}

function withPart(overrides) {
  return { ...valid, parts: [{ ...valid.parts[0], ...overrides }] };
}

function issuePaths(result) {
  assert.equal(result.ok, false);
  return result.issues.map((issue) => issue.path);
}

test("accepts a complete architecture file", () => {
  assert.deepEqual(parse(valid), { ok: true, file: valid });
});

test("accepts a minimal file without optional metadata", () => {
  const { source, generatedAt, ...minimal } = valid;
  assert.ok(source && generatedAt);
  const result = parse(minimal);
  assert.deepEqual(result, { ok: true, file: minimal });
  assert.equal("source" in result.file, false);
});

test("reports malformed JSON as a file-level issue", () => {
  const result = parseArchitectureFile("{ version: 1");
  assert.deepEqual(issuePaths(result), [""]);
  assert.match(result.issues[0].message, /^Invalid JSON/);
});

test("rejects unsupported versions and missing parts", () => {
  assert.deepEqual(issuePaths(parse({ ...valid, version: 2 })), ["version"]);
  assert.deepEqual(issuePaths(parse({ ...valid, parts: [] })), ["parts"]);
});

test("rejects declared connections and other unknown keys", () => {
  const result = parse({ ...valid, connections: [["web", "indexer"]] });
  assert.deepEqual(issuePaths(result), [""]);
  assert.match(result.issues[0].message, /connections/);
  assert.deepEqual(issuePaths(parse(withPart({ dependsOn: ["web"] }))), [
    "parts.0",
  ]);
});

test("rejects duplicate and malformed part ids", () => {
  const duplicate = {
    ...valid,
    parts: [valid.parts[0], { ...valid.parts[1], id: "indexer" }],
  };
  const result = parse(duplicate);
  assert.deepEqual(issuePaths(result), ["parts.1.id"]);
  assert.match(result.issues[0].message, /Duplicate part id "indexer"/);
  for (const id of ["Indexer", "-core", "core_engine", ""])
    assert.deepEqual(issuePaths(parse(withPart({ id }))), ["parts.0.id"], id);
});

test("requires single-line names and purposes", () => {
  assert.deepEqual(issuePaths(parse(withPart({ name: "" }))), ["parts.0.name"]);
  assert.deepEqual(issuePaths(parse(withPart({ name: " Core" }))), [
    "parts.0.name",
  ]);
  assert.deepEqual(
    issuePaths(parse(withPart({ purpose: "Parses files.\nAlso watches." }))),
    ["parts.0.purpose"],
  );
  assert.deepEqual(issuePaths(parse(withPart({ purpose: "x".repeat(201) }))), [
    "parts.0.purpose",
  ]);
});

test("rejects unknown part kinds", () => {
  assert.deepEqual(issuePaths(parse(withPart({ kind: "database" }))), [
    "parts.0.kind",
  ]);
});

test("requires repository-relative path patterns", () => {
  assert.deepEqual(issuePaths(parse(withPart({ paths: [] }))), [
    "parts.0.paths",
  ]);
  for (const path of [
    "",
    "/abs/src/**",
    "C:/repo/src",
    "src\\core\\**",
    "../outside/**",
    "./src/**",
    "src//core",
  ])
    assert.deepEqual(
      issuePaths(parse(withPart({ paths: ["src/**", path] }))),
      ["parts.0.paths.1"],
      path,
    );
});

test("validates optional metadata", () => {
  assert.deepEqual(issuePaths(parse({ ...valid, source: "human" })), [
    "source",
  ]);
  assert.deepEqual(issuePaths(parse({ ...valid, generatedAt: "yesterday" })), [
    "generatedAt",
  ]);
});
