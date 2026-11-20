import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { chromium, expect as baseExpect } from "@playwright/test";
import { startIndexedServer } from "../packages/server/dist/index.js";

const execFileAsync = promisify(execFile);
const expect = baseExpect.configure({ timeout: 15_000 });

async function git(cwd, args, date) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
    ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
  };
  await execFileAsync("git", args, { cwd, env, encoding: "utf8" });
}

async function writeFiles(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(root, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(
      fullPath,
      typeof content === "string" ? content : JSON.stringify(content, null, 2),
    );
  }
}

const directory = await mkdtemp(join(tmpdir(), "mycel-arch-e2e-"));
const root = join(directory, "repo");
await mkdir(root, { recursive: true });
await git(root, ["init", "-b", "main"]);

await writeFiles(root, {
  "package.json": { name: "acme", workspaces: ["packages/*"] },
  "packages/server/package.json": {
    name: "@acme/server",
    description: "HTTP API server.",
    exports: { ".": "./src/index.ts" },
  },
  "packages/server/src/index.ts": [
    'import { queryCore } from "@acme/core";',
    "export function serve() {",
    "  return queryCore();",
    "}",
    "",
  ].join("\n"),
  "packages/core/package.json": {
    name: "@acme/core",
    description: "Core domain logic.",
    exports: { ".": "./src/index.ts" },
  },
  "packages/core/src/index.ts": "export function queryCore() { return 1; }\n",
});

await git(root, ["add", "."]);
await git(root, ["commit", "-m", "initial"], "2026-10-01T12:00:00Z");
await git(root, ["checkout", "-b", "feat/db"]);

// Add a new `db` package and wire `core` -> `db`.
await writeFiles(root, {
  "packages/db/package.json": {
    name: "@acme/db",
    description: "SQLite storage.",
    exports: { ".": "./src/index.ts" },
  },
  "packages/db/src/index.ts": "export function readRows() { return []; }\n",
  "packages/core/src/index.ts": [
    'import { readRows } from "@acme/db";',
    "export function queryCore() {",
    "  return readRows();",
    "}",
    "",
  ].join("\n"),
});

const server = await startIndexedServer(0, {
  project: { name: "acme", root },
  databasePath: join(directory, "index.sqlite"),
});
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.goto(base);

  // 1. Lands on Architecture map with fallback banner, part cards, and change highlights.
  await expect(
    page.getByRole("heading", { name: "Architecture map", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Architecture fallback notice")).toBeVisible();

  const serverCard = page
    .locator(".react-flow__node-part")
    .filter({ hasText: "server" });
  const coreCard = page
    .locator(".react-flow__node-part")
    .filter({ hasText: "core" });
  const dbCard = page
    .locator(".react-flow__node-part")
    .filter({ hasText: "db" });

  await expect(serverCard).toContainText("HTTP API server.");
  await expect(coreCard).toHaveClass(/arch-part-changed/);
  await expect(dbCard).toHaveClass(/arch-part-new/);
  // Both one-import connections are minor, so they start hidden.
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  // Server's direct dependency stays readable even when its minor line is hidden.
  await serverCard.click();
  await expect(serverCard).toHaveCSS("opacity", "1");
  await expect(coreCard).toHaveCSS("opacity", "1");
  await expect(dbCard).toHaveCSS("opacity", "0.75");
  await expect(serverCard).toHaveCSS("border-top-color", "rgb(52, 211, 153)");
  await expect(coreCard).toHaveCSS("border-top-color", "rgb(147, 197, 253)");
  await expect(dbCard).toHaveCSS("border-top-color", "rgb(52, 56, 62)");

  await expect(page.locator(".react-flow__edge")).toHaveCount(0);

  const sidebar = page.getByRole("complementary", {
    name: "Selection details",
  });
  await expect(sidebar).not.toContainText("No connections to other parts.");
  const coreLink = sidebar.getByRole("button", { name: /^core / });
  await coreLink.hover();
  const preview = page.locator(".react-flow__edge");
  await expect(preview).toHaveCount(1);
  await expect(preview.locator(".react-flow__edge-text")).toHaveText(
    "1 import · 1 call",
  );
  await sidebar
    .getByRole("heading", { name: "Connections", exact: true })
    .hover();
  await expect(preview).toHaveCount(0);

  await page
    .getByRole("button", { name: "Show minor connections (2)" })
    .click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  const onlyConnections = page.getByRole("button", {
    name: "Only connections",
  });
  await onlyConnections.click();
  await expect(dbCard).toHaveCount(0);
  await expect(coreCard).toBeVisible();
  await onlyConnections.click();
  await page.getByRole("button", { name: "Clear selection" }).click();

  await expect(coreCard).toContainText("1 file");
  const edgeLabels = page.locator(".react-flow__edge-text");
  const edges = page.locator(".react-flow__edge");
  await expect(edgeLabels).toHaveCount(0);
  await expect(edges.locator(".react-flow__edge-path").first()).toHaveCSS(
    "stroke",
    "rgb(101, 113, 126)",
  );

  // Move over a real path so the count appears without selecting the connection.
  const midpoint = await edges
    .locator(".react-flow__edge-interaction")
    .first()
    .evaluate((path) => {
      const point = path.getPointAtLength(path.getTotalLength() / 2);
      const { x, y } = point.matrixTransform(path.getScreenCTM());
      return { x, y };
    });
  await page.mouse.move(midpoint.x, midpoint.y);
  await expect(edgeLabels).toHaveText("1 import · 1 call");

  // 2. Selecting a part shows connections, files, and allows drilling into connection evidence and source.
  await coreCard.click();
  await expect(sidebar).toContainText("Core domain logic.");
  await expect(sidebar).toContainText("Library · 1 file");
  await expect(sidebar).toContainText(
    "1 of 1 files changed · since branching from main · 1 uncommitted",
  );
  await expect(
    sidebar.getByRole("heading", { name: "Uses", exact: true }),
  ).toBeVisible();
  await expect(sidebar.getByLabel("Entry points")).toContainText(
    "Used by server · queryCore()",
  );
  const files = sidebar.getByLabel("Part files");
  await expect(files).toHaveAttribute("open", "");
  await expect(files).toContainText("packages/core/src");
  await expect(files.getByRole("button", { name: /index\.ts/ })).toContainText(
    "edited",
  );
  await expect(files.getByRole("button", { name: /index\.ts/ })).toContainText(
    "uncommitted",
  );
  await expect(coreCard).toHaveCSS("border-top-color", "rgb(52, 211, 153)");
  await expect(serverCard).toHaveCSS("border-top-color", "rgb(147, 197, 253)");
  await expect(dbCard).toHaveCSS("border-top-color", "rgb(147, 197, 253)");

  for (const edge of await edges.locator(".react-flow__edge-path").all()) {
    await expect(edge).toHaveCSS("stroke", "rgb(147, 197, 253)");
  }
  await expect(edgeLabels).toHaveCount(0);

  // Open connection evidence (`core -> db`).
  await sidebar.getByRole("button", { name: /db/ }).click();
  await expect(edgeLabels).toHaveText("1 import · 1 call");
  const evidence = page.getByLabel("Connection evidence");
  await expect(evidence).toContainText("packages/core/src/index.ts");
  await expect(evidence).toContainText("readRows");
  await expect(evidence.locator("details")).toHaveCount(1);

  // Click an evidence item to drill straight into source.
  await evidence
    .getByRole("button", { name: /packages\/core\/src\/index\.ts/ })
    .first()
    .click();
  await expect(
    page.getByRole("region", { name: "Source code" }).locator(".view-lines"),
  ).toContainText("readRows()");

  // Return to Architecture map and switch change window.
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Architecture map", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("group", { name: "Change window" })
    .getByRole("button", { name: "Uncommitted", exact: true })
    .click();
  await expect(
    page
      .getByRole("group", { name: "Change window" })
      .getByRole("button", { name: "Uncommitted", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  // 3. Writing `.mycel/architecture.json` updates the map live via SSE and clears fallback banner.
  await writeFiles(root, {
    ".mycel/architecture.json": {
      version: 1,
      source: "agent",
      parts: [
        {
          id: "api",
          name: "API layer",
          purpose: "Serves external requests.",
          kind: "service",
          paths: ["packages/server/**"],
        },
        {
          id: "engine",
          name: "Domain engine",
          purpose: "Coordinates application queries.",
          kind: "library",
          paths: ["packages/core/**"],
        },
        {
          id: "storage",
          name: "Storage",
          purpose: "Persists records in SQLite.",
          kind: "data",
          paths: ["packages/db/**"],
        },
      ],
    },
  });

  await expect(page.getByLabel("Architecture fallback notice")).toHaveCount(0);
  await expect(
    page.locator(".react-flow__node-part").filter({ hasText: "API layer" }),
  ).toBeVisible();
  await expect(
    page.locator(".react-flow__node-part").filter({ hasText: "Domain engine" }),
  ).toBeVisible();

  // 4. Drill down from part card into its file dependencies.
  await page
    .locator(".react-flow__node-part")
    .filter({ hasText: "Domain engine" })
    .click();
  await page.getByRole("button", { name: "Open files", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "File dependencies", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Architecture map", exact: true }),
  ).toBeVisible();

  assert.deepEqual(errors, [], "no browser runtime errors");
  console.log("PASS: architecture map end-to-end workflow");
} finally {
  await browser.close();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
  await rm(directory, { recursive: true, force: true });
}
