import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  unlink,
  readFile,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, expect as baseExpect } from "@playwright/test";
import { startIndexedServer } from "../packages/server/dist/index.js";

// Set MYCEL_WORKFLOW_DIR to use an external agent. It performs each edit only
// after <phase>.ready appears, then writes <phase>.done in the control directory.
const external = process.env.MYCEL_WORKFLOW_DIR;
const directory =
  external ?? (await mkdtemp(join(tmpdir(), "mycel-dashboard-")));
const root = join(directory, "repository");
const control = join(directory, "control");
await mkdir(root, { recursive: true });
await mkdir(control, { recursive: true });
execFileSync("git", ["init", "-q", root]);
await writeFile(
  join(root, "math.ts"),
  "export function double(value: number) {\n  return value * 2;\n}\n",
);
await writeFile(
  join(root, "main.ts"),
  'import { double } from "./math";\n\nexport function run() {\n  return double(3);\n}\n',
);
await writeFile(
  join(root, "obsolete.ts"),
  'export function obsolete() {\n  return "remove me";\n}\n',
);
const options = {
  project: { name: "dashboard-workflow", root },
  databasePath: join(directory, "index.sqlite"),
};
let server = await startIndexedServer(0, options);
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage();
const errors = [];
const offOrigin = [];
page.on("pageerror", (error) => {
  console.error("Browser runtime error:", error.stack ?? error.message);
  errors.push(error.message);
});
page.on("request", (request) => {
  if (
    !request.url().startsWith(base) &&
    !request.url().startsWith("blob:") &&
    !request.url().startsWith("data:")
  )
    offOrigin.push(request.url());
});
const expect = baseExpect.configure({ timeout: 15_000 });
async function phase(name, fallback) {
  console.log(
    `PHASE ${name} (${external ? "external agent" : "filesystem edit"})`,
  );
  if (external) {
    await writeFile(join(control, `${name}.ready`), root);
    await expect
      .poll(
        async () => {
          try {
            await access(join(control, `${name}.done`));
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 120_000, intervals: [250, 500, 1000] },
      )
      .toBe(true);
  } else await fallback();
}
async function json(path) {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200);
  return response.json();
}
async function closeServer() {
  console.log("Stopping server");
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}
async function sourceContains(text, label = "Source code") {
  await expect(
    page
      .getByRole("region", { name: label, exact: true })
      .locator(".view-lines"),
  ).toContainText(text);
}
async function graphFitsScreen() {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const canvas = globalThis.document.querySelector(".graph-canvas");
        const main = globalThis.document.querySelector("main");
        if (!canvas || !main) return false;
        const bounds = canvas.getBoundingClientRect();
        const bottom =
          main.getBoundingClientRect().bottom -
          Number.parseFloat(globalThis.getComputedStyle(main).paddingBottom);
        return (
          globalThis.document.documentElement.scrollHeight <=
            globalThis.window.innerHeight &&
          globalThis.document.documentElement.scrollWidth <=
            globalThis.window.innerWidth &&
          bounds.height > 0 &&
          Math.abs(bounds.bottom - bottom) <= 1
        );
      }),
    )
    .toBe(true);
}
async function selectionFitsScreen() {
  await graphFitsScreen();
  const sidebar = await page
    .getByRole("complementary", { name: "Selection details" })
    .boundingBox();
  const canvas = await page.locator(".graph-canvas").boundingBox();
  assert.ok(sidebar && canvas);
  assert.ok(
    Math.abs(sidebar.y - canvas.y) <= 1,
    "details align with the canvas top",
  );
  assert.ok(
    Math.abs(sidebar.y + sidebar.height - canvas.y - canvas.height) <= 1,
    "details stay within the canvas height",
  );
  assert.ok(
    sidebar.x >= canvas.x + canvas.width,
    "details take their own space beside the graph",
  );
  // The architecture map collapses its legend behind a toggle.
  const legend = await page
    .getByLabel("Graph legend")
    .or(page.getByRole("button", { name: "Legend", exact: true }))
    .first()
    .boundingBox();
  const toolbar = await page.getByLabel("Graph reading controls").boundingBox();
  assert.ok(legend && toolbar);
  assert.ok(
    legend.x + legend.width <= toolbar.x,
    "the legend leaves room for canvas controls",
  );
  await graphNodesFitCanvas();
}
async function graphNodesFitCanvas() {
  await expect
    .poll(() =>
      page.locator(".graph-canvas").evaluate((canvas) => {
        const bounds = canvas.getBoundingClientRect();
        const nodes = [...canvas.querySelectorAll(".react-flow__node")];
        return (
          nodes.length > 0 &&
          nodes.every((node) => {
            const rect = node.getBoundingClientRect();
            return (
              rect.left >= bounds.left &&
              rect.right <= bounds.right &&
              rect.top >= bounds.top &&
              rect.bottom <= bounds.bottom
            );
          })
        );
      }),
    )
    .toBe(true);
}
async function dragWithoutFlicker(node) {
  await expect
    .poll(() =>
      page
        .locator(".react-flow__node")
        .evaluateAll((nodes) =>
          nodes.every(
            (node) =>
              globalThis.getComputedStyle(node).visibility === "visible",
          ),
        ),
    )
    .toBe(true);
  await page.evaluate(() => {
    const canvas = globalThis.document.querySelector(".react-flow");
    const selector = ".react-flow__node, .react-flow__edge";
    const count = canvas.querySelectorAll(selector).length;
    const monitor = { failures: [], frames: 0, frame: 0, observer: null };
    const check = () => {
      const elements = [...canvas.querySelectorAll(selector)];
      if (elements.length !== count)
        monitor.failures.push("graph elements disappeared");
      for (const element of elements) {
        const style = globalThis.getComputedStyle(element);
        if (style.visibility === "hidden" || style.display === "none")
          monitor.failures.push(`${element.classList[0]} became hidden`);
      }
    };
    monitor.observer = new globalThis.MutationObserver((records) => {
      for (const record of records) {
        if (
          record.target.matches?.(selector) &&
          /visibility:\s*hidden/.test(record.oldValue ?? "")
        )
          monitor.failures.push("a node was temporarily hidden");
      }
      check();
    });
    monitor.observer.observe(canvas, {
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
      attributeOldValue: true,
      childList: true,
    });
    const frame = () => {
      monitor.frames++;
      check();
      monitor.frame = globalThis.requestAnimationFrame(frame);
    };
    monitor.frame = globalThis.requestAnimationFrame(frame);
    globalThis.mycelDragMonitor = monitor;
  });
  const bounds = await node.boundingBox();
  assert.ok(bounds);
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 - 80,
    bounds.y + bounds.height / 2 + 60,
    { steps: 30 },
  );
  await page.mouse.up();
  const result = await page.evaluate(() => {
    const monitor = globalThis.mycelDragMonitor;
    monitor.observer.disconnect();
    globalThis.cancelAnimationFrame(monitor.frame);
    delete globalThis.mycelDragMonitor;
    return { failures: [...new Set(monitor.failures)], frames: monitor.frames };
  });
  assert.ok(result.frames > 0, "dragging is sampled across animation frames");
  assert.deepEqual(
    result.failures,
    [],
    "nodes and edges must stay visible throughout dragging",
  );
}
try {
  console.log(`Dashboard: ${base} | fixture: ${directory}`);
  await page.goto(base);
  await expect(page.getByRole("status").first()).toHaveText("Connected");
  await expect(page.getByLabel("Live connection")).toHaveText("Live updates");
  await expect(
    page.getByRole("heading", { name: "Architecture map", exact: true }),
  ).toBeVisible();
  const legendToggle = page.getByRole("button", { name: "Legend" });
  await legendToggle.click();
  await expect(page.getByLabel("Graph legend")).toContainText(
    "imports or calls",
  );
  await legendToggle.click();
  await expect(page.getByLabel("Graph legend")).toHaveCount(0);
  await graphFitsScreen();
  await expect(page.getByLabel("Selection details")).toHaveCount(0);
  const canvasBounds = await page.locator(".react-flow").boundingBox();
  const legendBounds = await legendToggle.boundingBox();
  const toolbarBounds = await page
    .getByLabel("Graph reading controls")
    .boundingBox();
  assert.ok(canvasBounds && legendBounds && toolbarBounds);
  assert.ok(
    legendBounds.x >= canvasBounds.x &&
      legendBounds.x - canvasBounds.x <= 16 &&
      legendBounds.y >= canvasBounds.y &&
      legendBounds.y - canvasBounds.y <= 16,
    "legend belongs inside the canvas's top-left corner",
  );
  assert.ok(
    toolbarBounds.x + toolbarBounds.width <=
      canvasBounds.x + canvasBounds.width &&
      toolbarBounds.y - canvasBounds.y <= 16 &&
      toolbarBounds.x >= legendBounds.x + legendBounds.width,
    "canvas controls sit in the top-right without overlapping the legend",
  );
  const partNode = page
    .locator(".react-flow__node")
    .filter({ hasText: "repository" });
  const nodePosition = () => partNode.evaluate((node) => node.style.transform);
  const originalPosition = await nodePosition();
  await dragWithoutFlicker(partNode);
  await expect.poll(nodePosition).not.toBe(originalPosition);
  const draggedPosition = await nodePosition();
  await partNode.click();
  await selectionFitsScreen();
  for (const viewport of [
    { width: 768, height: 900 },
    { width: 1024, height: 768 },
    { width: 1440, height: 1100 },
  ]) {
    await page.setViewportSize(viewport);
    await selectionFitsScreen();
  }
  assert.equal(
    await nodePosition(),
    draggedPosition,
    "selection preserves dragged positions",
  );
  await page
    .getByRole("button", { name: "Clear selection", exact: true })
    .click();
  await expect(page.getByLabel("Selection details")).toHaveCount(0);
  await graphNodesFitCanvas();
  assert.equal(
    await nodePosition(),
    draggedPosition,
    "clearing preserves dragged positions",
  );
  await partNode.click();
  await page.getByRole("button", { name: "Open files", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "File dependencies", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page
    .locator(".react-flow__node")
    .filter({ hasText: "math.ts" })
    .click();
  await expect(page.locator(".graph-unrelated")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Only connections", exact: true })
    .click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Clear selection", exact: true })
    .click();
  await expect(page.locator(".react-flow__node")).toHaveCount(3);

  await page
    .locator(".react-flow__node")
    .filter({ hasText: "math.ts" })
    .click();
  await expect(page.getByLabel("Selected connections")).toContainText(
    "Used by",
  );
  await selectionFitsScreen();
  await page.getByRole("button", { name: "Open file", exact: true }).click();
  await page
    .getByLabel("File symbols")
    .getByRole("button", { name: /double.*function/ })
    .click();
  await expect(page.getByLabel("Node details")).toContainText("double");
  await selectionFitsScreen();
  await dragWithoutFlicker(
    page.locator(".react-flow__node").filter({ hasText: "double" }),
  );
  await page.screenshot({
    path: join(directory, "graph-sidebar.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Explorer", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search files and symbols" })
    .fill("double");
  await page.getByRole("button", { name: /double.*function/ }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await page.getByRole("button", { name: "Expand", exact: true }).click();
  await expect(page.getByText("Depth 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Collapse", exact: true }).click();
  await expect(page.getByText("Depth 1", { exact: true })).toBeVisible();
  const details = page.getByLabel("Node details");
  await details.getByRole("button", { name: /run.*main.ts/ }).click();
  await details
    .getByRole("button", { name: "Open source", exact: true })
    .click();
  await sourceContains("double(3)");
  await selectionFitsScreen();
  await expect(
    page.getByRole("region", { name: "Source code" }).getByRole("heading"),
  ).toHaveText("main.ts:3");
  await page.locator(".react-flow__node").filter({ hasText: "double" }).click();
  await sourceContains("value * 2");
  await phase("create", () =>
    writeFile(
      join(root, "generated.ts"),
      'import { double } from "./math";\nexport function generated() {\n  return double(4);\n}\n',
    ),
  );
  await expect(
    page.locator(".recent-created").filter({ hasText: "generated" }),
  ).toBeVisible();
  await phase("modify", () =>
    writeFile(
      join(root, "math.ts"),
      "export function double(value: number) {\n  return value * 3;\n}\n",
    ),
  );
  await sourceContains("value * 3");
  await expect(
    page.locator(".recent-modified").filter({ hasText: "double" }),
  ).toBeVisible();
  const double = (await json("/api/graph/search?q=double")).nodes.find(
    (node) => node.kind === "function",
  );
  const obsolete = (await json("/api/graph/search?q=obsolete")).nodes.find(
    (node) => node.kind === "function",
  );
  const changes = await json("/api/changes?limit=100");
  const modified = changes.items.find(
    (event) => event.entityId === double.id && event.action === "modified",
  );
  assert.ok(modified);
  await page
    .getByRole("button", { name: "Show node activity", exact: true })
    .click();
  await page.getByRole("button", { name: /modified double/ }).click();
  await expect(
    page
      .getByRole("region", { name: "Recorded source diff" })
      .locator(".monaco-diff-editor"),
  ).toBeVisible();
  const diff = await json(`/api/changes/${modified.id}/diff`);
  assert.match(diff.beforeContent, /value \* 2/);
  assert.match(diff.afterContent, /value \* 3/);
  await page.getByRole("button", { name: "Open recorded source" }).click();
  await sourceContains("value * 3", "Recorded source");
  const savedUrl = page.url();
  await page.reload();
  await sourceContains("value * 3", "Recorded source");
  assert.equal(page.url(), savedUrl);
  await page.getByRole("button", { name: "Open live graph" }).click();
  await expect(page.locator(".react-flow__node")).not.toHaveCount(0);
  await page.goBack();
  await sourceContains("value * 3", "Recorded source");
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await phase("delete", () => unlink(join(root, "obsolete.ts")));
  await page
    .getByRole("button", { name: /deleted obsolete.ts/ })
    .first()
    .click();
  await expect(page.getByLabel("Historical node")).toContainText(
    "Deleted from the live graph",
  );
  await expect(
    page.getByRole("button", { name: "Open live graph" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Open recorded source" }).click();
  await sourceContains("remove me", "Recorded source");
  await page.goto(
    `${base}/#${new URLSearchParams({ view: "Graph", node: obsolete.id, root: obsolete.id })}`,
  );
  await page.getByRole("button", { name: "Show node history" }).click();
  await expect(page.getByLabel("Historical node")).toContainText("obsolete");
  await closeServer();
  await expect(page.getByRole("status").first()).toHaveText("Disconnected");
  await expect(page.getByLabel("Live connection")).toHaveText(
    "Live reconnecting…",
  );
  server = await startIndexedServer(port, options);
  await expect(page.getByRole("status").first()).toHaveText("Connected");
  await expect(page.getByLabel("Live connection")).toHaveText("Live updates");
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await phase("reconnect", () =>
    writeFile(
      join(root, "math.ts"),
      "export function double(value: number) {\n  return value * 4;\n}\n",
    ),
  );
  await expect
    .poll(async () => (await json("/api/files/content?path=math.ts")).content)
    .toContain("value * 4");
  await expect(
    page.getByRole("button", { name: /modified double/ }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: /modified double/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Open recorded source" }).click();
  await sourceContains("value * 4", "Recorded source");
  await page.screenshot({
    path: join(directory, "history.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await graphFitsScreen();
  await page.locator(".react-flow__node").first().click();
  await selectionFitsScreen();
  await page.screenshot({
    path: join(directory, "graph-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Clear selection", exact: true })
    .click();
  await expect(page.getByLabel("Selection details")).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await graphFitsScreen();
  await graphNodesFitCanvas();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Explorer", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Search files and symbols" }),
  ).toBeVisible();
  assert.ok(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.window.innerWidth,
    ),
    "mobile page must not overflow horizontally",
  );
  assert.deepEqual(errors, [], "browser runtime errors");
  assert.deepEqual(
    offOrigin,
    [],
    "all assets and Monaco workers must stay local",
  );
  assert.match(await readFile(join(root, "math.ts"), "utf8"), /value \* 4/);
  await writeFile(
    join(directory, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        externalAgent: Boolean(external),
        browserErrors: errors,
        offOriginRequests: offOrigin,
        modifiedChange: modified.id,
        fixture: directory,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: dashboard workflow${external ? " with external coding agent" : ""}. Evidence: ${directory}`,
  );
} catch (error) {
  await page
    .screenshot({ path: join(directory, "failure.png"), fullPage: true })
    .catch(() => {});
  console.error("Browser errors:", errors);
  console.error("Page:", await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
  if (server.listening) await closeServer();
}
