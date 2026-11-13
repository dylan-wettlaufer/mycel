import assert from "node:assert/strict";
import { parseFile } from "@mycel/parser";
import test from "node:test";
import { buildProjectGraph } from "../dist/graph.js";

const project = {
  id: "fixture",
  root: "/fixture",
  name: "fixture",
  indexing: {
    extensions: [".ts", ".tsx"],
    respectGitignore: true,
    exclude: [],
  },
};
function graph(sources) {
  return buildProjectGraph(
    project,
    Object.entries(sources).map(([path, source]) => ({
      source,
      parsed: parseFile(path, source),
    })),
  );
}
function relationships(g, kind) {
  const byId = new Map(
    g.nodes.map((n) => [n.id, `${n.path}:${n.qualifiedName}`]),
  );
  return g.edges
    .filter((e) => e.kind === kind)
    .map((e) => [byId.get(e.sourceId), byId.get(e.targetId)])
    .sort();
}

test("resolves named/default/namespace imports, aliases, re-exports, local calls, and static methods", () => {
  const g = graph({
    "lib.ts":
      "export function work() {} export default function run() {} export class Tool { static open() {} }",
    "barrel/index.ts":
      "export {work as action, default} from '../lib.js'; export * as nested from '../lib'; export * from '../lib';",
    "main.ts":
      "import run, {action as invoke, Tool} from './barrel'; import * as api from './barrel'; import type {work} from './lib'; function caller() { invoke(); run(); api.nested.work(); Tool.open(); local(); work(); unknown(); } function local() {}",
  });
  assert.deepEqual(relationships(g, "CALLS"), [
    ["main.ts:caller", "lib.ts:Tool.open"],
    ["main.ts:caller", "lib.ts:run"],
    ["main.ts:caller", "lib.ts:work"],
    ["main.ts:caller", "main.ts:local"],
  ]);
  assert.deepEqual(relationships(g, "IMPORTS"), [
    ["barrel/index.ts:barrel/index.ts", "lib.ts:lib.ts"],
    ["main.ts:main.ts", "barrel/index.ts:barrel/index.ts"],
    ["main.ts:main.ts", "lib.ts:lib.ts"],
  ]);
  assert.deepEqual(g.diagnostics, []);
});

test("handles missing modules, cycles, ambiguous star exports, and non-exported symbols", () => {
  const g = graph({
    "a.ts":
      "export * from './b'; export function same() {} function hidden() {}",
    "b.ts": "export * from './a';",
    "other.ts": "export function same() {}",
    "barrel.ts": "export * from './a'; export * from './other';",
    "main.ts":
      "import {same} from './barrel'; import {hidden} from './a'; import './missing'; import 'external'; function caller() { same(); hidden(); }",
  });
  assert.deepEqual(relationships(g, "CALLS"), []);
  assert.deepEqual(
    g.diagnostics.map((d) => d.code),
    ["unresolved-module"],
  );
  assert.equal(g.diagnostics[0].path, "main.ts");
});

test("resolves lexical recursion, module initialization, and this methods without guessing object types", () => {
  const g = graph({
    "main.ts":
      "function top() {} top(); function outer() { function inner() { inner(); top(); } inner(); } class Tool { first() { this.second(); } second() {} } function unknown(receiver) { receiver.second(); this.top(); }",
  });
  assert.deepEqual(relationships(g, "CALLS"), [
    ["main.ts:Tool.first", "main.ts:Tool.second"],
    ["main.ts:main.ts", "main.ts:top"],
    ["main.ts:outer", "main.ts:outer.inner"],
    ["main.ts:outer.inner", "main.ts:outer.inner"],
    ["main.ts:outer.inner", "main.ts:top"],
  ]);
});
