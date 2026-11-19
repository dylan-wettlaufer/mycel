import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildFallbackArchitecture,
  parseArchitectureFile,
} from "../dist/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), "mycel-fallback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(root, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(
      fullPath,
      typeof content === "string" ? content : JSON.stringify(content, null, 2),
    );
  }
  return root;
}

function assertValidArchitectureFile(file) {
  const parsed = parseArchitectureFile(JSON.stringify(file));
  assert.deepEqual(parsed, { ok: true, file });
}

test("generates workspace parts for Mycel itself", async () => {
  const result = await buildFallbackArchitecture(repoRoot);
  assertValidArchitectureFile(result);
  assert.equal(result.version, 1);
  assert.equal(result.source, "folder-fallback");

  const byId = new Map(result.parts.map((part) => [part.id, part]));
  assert.deepEqual(
    [...byId.keys()],
    ["cli", "core", "db", "parser", "server", "shared", "web"],
  );

  assert.deepEqual(byId.get("cli"), {
    id: "cli",
    name: "cli",
    purpose: "Command-line entry point and application lifecycle.",
    kind: "cli",
    paths: ["packages/cli/**"],
  });
  assert.equal(byId.get("server")?.kind, "service");
  assert.deepEqual(byId.get("server")?.paths, ["packages/server/**"]);
  assert.equal(byId.get("core")?.kind, "library");
  assert.deepEqual(byId.get("core")?.paths, ["packages/core/**"]);
  assert.equal(byId.get("parser")?.kind, "library");
  assert.deepEqual(byId.get("parser")?.paths, ["packages/parser/**"]);
  assert.equal(byId.get("db")?.kind, "data");
  assert.deepEqual(byId.get("db")?.paths, ["packages/db/**"]);
  assert.equal(byId.get("web")?.kind, "app");
  assert.deepEqual(byId.get("web")?.paths, ["apps/web/**"]);
});

test("supports pnpm workspaces with negations and overrides package.json workspaces", async (t) => {
  const root = await fixture(t, {
    "package.json": {
      name: "monorepo",
      workspaces: ["ignored/*"],
    },
    "pnpm-workspace.yaml": [
      "packages:",
      '  - "packages/*"',
      '  - "apps/*/"',
      '  - "!packages/internal"',
      "",
    ].join("\n"),
    "ignored/other/package.json": { name: "other" },
    "packages/internal/package.json": { name: "internal" },
    "packages/sdk/package.json": {
      name: "@acme/sdk",
      description: "Client SDK\nfor external callers.",
    },
    "apps/dashboard/package.json": {
      name: "@acme/dashboard",
    },
  });

  const result = await buildFallbackArchitecture(root);
  assertValidArchitectureFile(result);
  assert.deepEqual(result.parts, [
    {
      id: "dashboard",
      name: "dashboard",
      purpose: "Workspace package at apps/dashboard.",
      kind: "app",
      paths: ["apps/dashboard/**"],
    },
    {
      id: "sdk",
      name: "sdk",
      purpose: "Client SDK for external callers.",
      kind: "library",
      paths: ["packages/sdk/**"],
    },
  ]);
});

test("supports npm and yarn workspaces in array and object formats", async (t) => {
  const arrayRoot = await fixture(t, {
    "package.json": {
      name: "npm-ws",
      workspaces: ["services/*", "libs/*"],
    },
    "services/billing/package.json": {
      name: "billing",
      description: "Processes invoices.",
    },
    "libs/common/package.json": {
      name: "@acme/common",
    },
  });

  const arrayResult = await buildFallbackArchitecture(arrayRoot);
  assertValidArchitectureFile(arrayResult);
  assert.deepEqual(
    arrayResult.parts.map((part) => [part.id, part.kind, part.paths]),
    [
      ["billing", "service", ["services/billing/**"]],
      ["common", "library", ["libs/common/**"]],
    ],
  );

  const objectRoot = await fixture(t, {
    "package.json": {
      name: "yarn-ws",
      workspaces: {
        packages: ["tools/*", "integrations/*"],
      },
    },
    "tools/runner/package.json": {
      name: "runner",
      bin: "./bin/run.js",
    },
    "integrations/stripe/package.json": {
      name: "stripe-sync",
    },
  });

  const objectResult = await buildFallbackArchitecture(objectRoot);
  assertValidArchitectureFile(objectResult);
  assert.deepEqual(
    objectResult.parts.map((part) => [part.id, part.kind, part.paths]),
    [
      ["runner", "cli", ["tools/runner/**"]],
      ["stripe-sync", "integration", ["integrations/stripe/**"]],
    ],
  );
});

test("supports Cargo workspaces with globs, excludes, and non-virtual root crates", async (t) => {
  const root = await fixture(t, {
    "Cargo.toml": [
      "[package]",
      'name = "acme-root"',
      'description = "Root entry point."',
      "",
      "[workspace]",
      'resolver = "2"',
      "members = [",
      '  "crates/*", # all crates',
      '  "services/api",',
      "]",
      'exclude = ["crates/scratch"]',
      "",
    ].join("\n"),
    "src/main.rs": "fn main() {}",
    "crates/engine/Cargo.toml": [
      "[package]",
      'name = "acme-engine"',
      'description = "Core compute library."',
      "",
    ].join("\n"),
    "crates/engine/src/lib.rs": "pub fn run() {}",
    "crates/scratch/Cargo.toml": '[package]\nname = "scratch"\n',
    "services/api/Cargo.toml": [
      "[package]",
      'name = "api"',
      'description = "HTTP API daemon."',
      "",
      "[[bin]]",
      'name = "api"',
      "",
    ].join("\n"),
    "services/api/src/main.rs": "fn main() {}",
  });

  const result = await buildFallbackArchitecture(root);
  assertValidArchitectureFile(result);
  assert.deepEqual(result.parts, [
    {
      id: "acme-engine",
      name: "acme-engine",
      purpose: "Core compute library.",
      kind: "library",
      paths: ["crates/engine/**"],
    },
    {
      id: "acme-root",
      name: "acme-root",
      purpose: "Root entry point.",
      kind: "cli",
      paths: ["src/**"],
    },
    {
      id: "api",
      name: "api",
      purpose: "HTTP API daemon.",
      kind: "service",
      paths: ["services/api/**"],
    },
  ]);
});

test("supports Go workspaces with block and single-line use directives", async (t) => {
  const root = await fixture(t, {
    "go.work": [
      "go 1.23",
      "",
      "use (",
      "  ./cmd/mytool // CLI binary",
      '  "./services/worker"',
      "  ../outside",
      "  ./missing",
      ")",
      "",
      "use ./pkg/storage",
      "",
    ].join("\n"),
    "cmd/mytool/go.mod": "module github.com/acme/repo/cmd/mytool\n",
    "cmd/mytool/main.go": "package main\n",
    "services/worker/go.mod": "module github.com/acme/repo/services/worker\n",
    "services/worker/worker.go": "package worker\n",
    "pkg/storage/go.mod": "module github.com/acme/repo/pkg/storage\n",
    "pkg/storage/db.go": "package storage\n",
  });

  const result = await buildFallbackArchitecture(root);
  assertValidArchitectureFile(result);
  assert.deepEqual(
    result.parts.map((part) => [part.id, part.kind, part.paths]),
    [
      ["mytool", "cli", ["cmd/mytool/**"]],
      ["storage", "data", ["pkg/storage/**"]],
      ["worker", "service", ["services/worker/**"]],
    ],
  );
});

test("merges workspace packages across polyglot manifests", async (t) => {
  const root = await fixture(t, {
    "pnpm-workspace.yaml": 'packages:\n  - "apps/*"\n',
    "apps/web/package.json": { name: "@poly/web", description: "Web UI." },
    "Cargo.toml": '[workspace]\nmembers = ["crates/*"]\n',
    "crates/native/Cargo.toml": '[package]\nname = "native"\n',
  });

  const result = await buildFallbackArchitecture(root);
  assertValidArchitectureFile(result);
  assert.deepEqual(
    result.parts.map((part) => [part.id, part.paths]),
    [
      ["native", ["crates/native/**"]],
      ["web", ["apps/web/**"]],
    ],
  );
});

test("falls back to top-level source folders and ignores non-source, hidden, excluded, and gitignored dirs", async (t) => {
  const root = await fixture(t, {
    ".gitignore": "generated/\n",
    ".github/workflows/ci.yml": "name: ci\n",
    "docs/overview.md": "# Docs\n",
    "public/logo.svg": "<svg></svg>\n",
    "dist/bundle.js": "console.log(1);\n",
    "__pycache__/mod.py": "x = 1\n",
    "generated/client.py": "x = 1\n",
    "api/routes.py": "def index(): pass\n",
    "worker/tasks.py": "def run(): pass\n",
    "shared/models.py": "class Order: pass\n",
  });

  const result = await buildFallbackArchitecture(root);
  assertValidArchitectureFile(result);
  assert.deepEqual(result.parts, [
    {
      id: "api",
      name: "api",
      purpose: "Source files in api.",
      kind: "service",
      paths: ["api/**"],
    },
    {
      id: "shared",
      name: "shared",
      purpose: "Source files in shared.",
      kind: "library",
      paths: ["shared/**"],
    },
    {
      id: "worker",
      name: "worker",
      purpose: "Source files in worker.",
      kind: "service",
      paths: ["worker/**"],
    },
  ]);
});

test("unwraps src/ when it is the primary source root with multiple subdirectories", async (t) => {
  const root = await fixture(t, {
    "package.json": { name: "single-app" },
    "docs/guide.md": "# Guide\n",
    "prisma/schema.prisma": "model Order { id Int @id }\n",
    "src/index.ts": "export const ready = true;\n",
    "src/app/page.tsx": "export default function Page() { return null; }\n",
    "src/components/Button.tsx": "export function Button() { return null; }\n",
    "src/services/orders.ts": "export function listOrders() { return []; }\n",
  });

  const result = await buildFallbackArchitecture(root);
  assertValidArchitectureFile(result);
  assert.deepEqual(
    result.parts.map((part) => [part.id, part.kind, part.paths]),
    [
      ["app", "app", ["src/app/**"]],
      ["components", "library", ["src/components/**"]],
      ["prisma", "data", ["prisma/**"]],
      ["services", "service", ["src/services/**"]],
      ["src", "library", ["src/*"]],
    ],
  );

  // When src has no subdirectories, keep src/** as one part.
  const flatSrcRoot = await fixture(t, {
    "src/index.ts": "export const a = 1;\n",
    "src/utils.ts": "export const b = 2;\n",
    "test/index.test.ts": "export {};\n",
  });
  const flatSrcResult = await buildFallbackArchitecture(flatSrcRoot);
  assertValidArchitectureFile(flatSrcResult);
  assert.deepEqual(
    flatSrcResult.parts.map((part) => [part.id, part.paths]),
    [
      ["src", ["src/**"]],
      ["test", ["test/**"]],
    ],
  );
});

test("derives folder fallback from pre-discovered filePaths when supplied", async (t) => {
  const root = await fixture(t, { "README.md": "# Empty on disk" });
  const result = await buildFallbackArchitecture(root, {
    filePaths: [
      "src/auth/login.ts",
      "src/billing/charge.ts",
      "src/index.ts",
      "tests/auth.test.ts",
    ],
    exclude: ["tests/**"],
  });
  assertValidArchitectureFile(result);
  assert.deepEqual(
    result.parts.map((part) => [part.id, part.paths]),
    [
      ["auth", ["src/auth/**"]],
      ["billing", ["src/billing/**"]],
      ["src", ["src/*"]],
    ],
  );
});

test("handles root-only repositories and empty repositories cleanly", async (t) => {
  const rootOnly = await fixture(t, {
    "main.ts": "export const main = true;\n",
    "utils.ts": "export const util = true;\n",
  });
  const rootResult = await buildFallbackArchitecture(rootOnly);
  assertValidArchitectureFile(rootResult);
  assert.equal(rootResult.parts.length, 1);
  assert.equal(rootResult.parts[0].id, "root");
  assert.deepEqual(rootResult.parts[0].paths, ["**"]);

  const emptyRoot = await fixture(t, {
    "README.md": "# Empty\n",
  });
  const emptyResult = await buildFallbackArchitecture(emptyRoot);
  assert.deepEqual(emptyResult, {
    version: 1,
    source: "folder-fallback",
    parts: [],
  });
});

test("disambiguates colliding slugs and ignores malformed manifests and symlinks", async (t) => {
  const root = await fixture(t, {
    "pnpm-workspace.yaml": "packages: [unclosed",
    "package.json": {
      name: "collisions",
      workspaces: ["apps/*", "packages/*"],
    },
    "apps/api/package.json": { name: "@a/api" },
    "packages/api/package.json": { name: "@b/api" },
    "packages/broken/package.json": "{ invalid json",
  });

  const outside = await mkdtemp(join(tmpdir(), "mycel-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(
    join(outside, "package.json"),
    JSON.stringify({ name: "escaped" }),
  );
  await symlink(outside, join(root, "packages", "linked"));

  const result = await buildFallbackArchitecture(root);
  assertValidArchitectureFile(result);
  assert.deepEqual(
    result.parts.map((part) => [part.id, part.paths]),
    [
      ["apps-api", ["apps/api/**"]],
      ["broken", ["packages/broken/**"]],
      ["packages-api", ["packages/api/**"]],
    ],
  );
});
