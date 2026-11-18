import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { startIndexedServer } from "../packages/server/dist/index.js";

const fixture = fileURLToPath(
  new URL("../packages/core/test/fixtures/behaviour/", import.meta.url),
);
const directory = await mkdtemp(join(tmpdir(), "mycel-feature-workflow-"));
let server;
let browser;
try {
  const root = join(directory, "repository");
  const files = await readdir(fixture, { recursive: true });
  for (const file of files) {
    if (
      !file.endsWith(".txt") ||
      ["Form.tsx.txt", "client.ts.txt"].includes(file)
    )
      continue;
    const destination = join(root, file.slice(0, -4));
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(fixture, file), destination);
  }
  server = await startIndexedServer(0, {
    project: { name: "orders-workflow", root },
    databasePath: join(directory, "index.sqlite"),
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Features" })
    .click();
  await page.getByRole("button", { name: /^Orders\b/ }).click();
  await expect(
    page.getByRole("heading", { name: "Orders", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Feature parts", exact: true }),
  ).toHaveCount(0);
  const graph = page.getByRole("region", { name: "Behaviour graph" });
  const event = graph.getByLabel("Submit Order, form.onSubmit, UI Event", {
    exact: true,
  });
  const readEndpoint = graph.getByLabel(
    "List Orders, GET /api/orders, API Endpoint",
    {
      exact: true,
    },
  );
  const writeEndpoint = graph.getByLabel(
    "Create Order, POST /api/orders, API Endpoint",
    {
      exact: true,
    },
  );
  const model = graph.getByLabel("Order Data, Order, Data Model", {
    exact: true,
  });
  const nodes = graph.locator(".react-flow__node-code");
  const layers = graph.locator(".react-flow__node-layer");
  const canvas = graph.locator(".graph-canvas");
  const fitAll = graph.getByRole("button", { name: "Fit all" });
  const legend = graph.getByRole("button", { name: "Legend" });
  const selection = graph.getByRole("complementary", {
    name: "Selection details",
  });
  const empty = selection.getByText(
    "Select a node to see its role, connections, and source.",
  );
  await expect(nodes).toHaveCount(4);
  await expect(empty).toBeVisible();
  await expect(event).toBeVisible();
  await expect(readEndpoint).toBeVisible();
  await expect(writeEndpoint).toBeVisible();
  await expect(model).toBeVisible();
  await expect(layers).toHaveCount(3);
  await expect(layers.locator(".layer-node-title")).toHaveText([
    "UI (Frontend)",
    "API (Backend)",
    "Data (Persistence)",
  ]);
  await expect(writeEndpoint.locator(".operation-node-title")).toHaveText(
    "Create Order",
  );
  await expect(writeEndpoint.locator("code")).toHaveText("POST /api/orders");
  await expect(writeEndpoint.locator(".operation-node-type")).toHaveText(
    "API Endpoint",
  );
  const effectiveTitleSize = (node) =>
    node.locator(".operation-node-title").evaluate((title) => {
      const node = title.closest(".react-flow__node");
      const zoom = node.getBoundingClientRect().width / node.offsetWidth;
      return (
        Number.parseFloat(globalThis.getComputedStyle(title).fontSize) * zoom
      );
    });
  await expect.poll(() => effectiveTitleSize(event)).toBeGreaterThanOrEqual(16);
  const spaceBelowCanvas = () =>
    canvas.evaluate(
      (element) =>
        globalThis.innerHeight - element.getBoundingClientRect().bottom,
    );
  const canvasHeight = () => canvas.evaluate((element) => element.clientHeight);
  await expect.poll(spaceBelowCanvas).toBeCloseTo(24);
  await expect.poll(canvasHeight).toBeGreaterThan(450);
  const desktopCanvasHeight = await canvasHeight();
  await expect(event.locator(".react-flow__handle-right")).toHaveCount(1);
  await expect(legend).toHaveAttribute("aria-expanded", "false");
  await legend.click();
  await expect(legend).toHaveAttribute("aria-expanded", "true");
  await expect(graph.getByText("Unresolved or inferred")).toBeVisible();
  await legend.click();
  const [eventId, readId, writeId, modelId] = await Promise.all(
    [event, readEndpoint, writeEndpoint, model].map((node) =>
      node.getAttribute("data-id"),
    ),
  );
  await expect
    .poll(() =>
      graph
        .locator(".react-flow__edge")
        .evaluateAll((edges) =>
          edges.map((edge) => edge.getAttribute("data-id")).sort(),
        ),
    )
    .toEqual(
      [
        [eventId, readId],
        [eventId, writeId],
        [readId, modelId],
        [writeId, modelId],
      ]
        .map((pair) => JSON.stringify(pair))
        .sort(),
    );
  await expect(graph.getByText("reads", { exact: true })).toBeVisible();
  await expect(graph.getByText("writes", { exact: true })).toBeVisible();

  const background = await writeEndpoint.evaluate(
    (node) => globalThis.getComputedStyle(node).backgroundColor,
  );
  await writeEndpoint.hover();
  await expect
    .poll(() =>
      writeEndpoint.evaluate(
        (node) => globalThis.getComputedStyle(node).backgroundColor,
      ),
    )
    .not.toBe(background);
  const showWrite = writeEndpoint.getByRole("button", {
    name: "Show call steps for POST /api/orders",
  });
  const hideWrite = writeEndpoint.getByRole("button", {
    name: "Hide call steps for POST /api/orders",
  });
  const showRead = readEndpoint.getByRole("button", {
    name: "Show call steps for GET /api/orders",
  });
  const hideRead = readEndpoint.getByRole("button", {
    name: "Hide call steps for GET /api/orders",
  });
  await expect(showWrite).toHaveAttribute("aria-expanded", "false");
  await expect(
    event.getByRole("button", { name: "Show call steps for form.onSubmit" }),
  ).toBeVisible();
  await expect(model.getByRole("button")).toHaveCount(0);

  const viewport = graph.locator(".react-flow__viewport");
  const readTransform = () =>
    viewport.evaluate((element) => element.style.transform);
  const readZoom = async () =>
    Number((await readTransform()).match(/scale\(([^)]+)\)/)?.[1]);
  const collapsedZoom = await readZoom();
  const nodesFit = () =>
    canvas.evaluate((canvas) => {
      const bounds = canvas.getBoundingClientRect();
      const cards = [...canvas.querySelectorAll(".react-flow__node")];
      return (
        cards.length > 0 &&
        cards.every((node) => {
          const card = node.getBoundingClientRect();
          return (
            card.left >= bounds.left &&
            card.right <= bounds.right &&
            card.top >= bounds.top &&
            card.bottom <= bounds.bottom
          );
        })
      );
    });
  const writeHandler = graph.getByLabel("Handle POST Request, POST, Function", {
    exact: true,
  });
  const writeService = graph.getByLabel("Create Order, createOrder, Service", {
    exact: true,
  });
  const readService = graph.getByLabel("List Orders, listOrders, Service", {
    exact: true,
  });
  const submitHandler = graph.getByLabel(
    "Handle Submit, handleSubmit, Function",
    { exact: true },
  );
  await writeEndpoint.click();
  await expect(writeEndpoint).toHaveClass(/graph-selected/);
  await expect.poll(canvasHeight).toBe(desktopCanvasHeight);
  await expect.poll(readZoom).toBeCloseTo(collapsedZoom);
  const connectionsFilter = graph.getByRole("button", {
    name: "Only connections",
  });
  await connectionsFilter.click();
  await expect(connectionsFilter).toHaveAttribute("aria-pressed", "true");
  await expect(nodes).toHaveCount(3);
  await expect.poll(readZoom).toBeCloseTo(collapsedZoom);
  await connectionsFilter.click();
  await expect(nodes).toHaveCount(4);
  const overview = selection.getByRole("region", { name: "Overview" });
  await expect(
    overview.getByRole("heading", { name: "Create Order" }),
  ).toBeVisible();
  await expect(
    overview.getByText("API Endpoint", { exact: true }),
  ).toBeVisible();
  await expect(
    overview.getByText("POST /api/orders", { exact: true }),
  ).toBeVisible();
  await expect(
    overview.getByText(
      "Handles POST requests to /api/orders and calls createOrder.",
    ),
  ).toBeVisible();
  const connections = selection.getByRole("region", { name: "Connections" });
  await expect(
    connections.getByRole("heading", { name: "Called from / triggered by" }),
  ).toBeVisible();
  await expect(
    connections.getByRole("button", { name: /^Submit Order/ }),
  ).toBeVisible();
  const requestConnection = connections.getByRole("button", {
    name: /^Send POST Request/,
  });
  await expect(requestConnection).toBeVisible();
  await expect(
    connections.getByRole("heading", { name: "Calls / connects to" }),
  ).toBeVisible();
  const handlerConnection = connections.getByRole("button", {
    name: /^Handle POST Request/,
  });
  await expect(handlerConnection).toBeVisible();
  await expect(
    connections.getByRole("heading", { name: "Reads or writes" }),
  ).toBeVisible();
  const dataConnection = connections.getByRole("button", {
    name: "Order Data Writes via 3 steps",
  });
  await expect(dataConnection).toBeVisible();
  const implementation = selection.getByRole("region", {
    name: "Implementation",
  });
  const source = implementation.getByRole("button", {
    name: "Open source at app/api/orders/route.ts:2 in POST",
  });
  await expect(source).toBeInViewport({ ratio: 0.95 });

  const detailedTrace = selection.getByRole("button", {
    name: "Detailed trace",
  });
  await expect(detailedTrace).toHaveAttribute("aria-expanded", "false");
  await expect(
    selection.getByText("app/api/orders/route.ts:4", { exact: true }),
  ).toHaveCount(0);
  await detailedTrace.click();
  await expect(detailedTrace).toHaveAttribute("aria-expanded", "true");
  await expect(
    selection.getByText("app/api/orders/route.ts:4", { exact: true }),
  ).toBeVisible();
  await expect(writeEndpoint).toHaveClass(/graph-selected/);
  const panelViewport = selection.locator('[data-slot="scroll-area-viewport"]');
  await expect
    .poll(() =>
      panelViewport.evaluate(
        (viewport) => viewport.scrollHeight > viewport.clientHeight,
      ),
    )
    .toBe(true);
  await detailedTrace.click();
  await expect(detailedTrace).toHaveAttribute("aria-expanded", "false");

  await source.click();
  const sourceViewer = page.getByRole("dialog", { name: "Source viewer" });
  await expect(
    sourceViewer.getByRole("heading", { name: "app/api/orders/route.ts:2" }),
  ).toBeVisible();
  await expect(sourceViewer.locator(".monaco-editor")).toBeVisible();
  await sourceViewer.getByRole("button", { name: "Close source" }).click();
  await expect(sourceViewer).toHaveCount(0);
  await expect(source).toBeFocused();
  await expect(writeEndpoint).toHaveClass(/graph-selected/);

  await dataConnection.click();
  await expect(model).toHaveClass(/graph-selected/);
  await expect(model).toBeInViewport({ ratio: 0.9 });
  await expect(
    connections.getByRole("button", {
      name: /^Create Order Writes to this model/,
    }),
  ).toBeVisible();
  await connections
    .getByRole("button", { name: /^Create Order Writes to this model/ })
    .click();
  await expect(writeEndpoint).toHaveClass(/graph-selected/);

  await handlerConnection.click();
  await expect(writeHandler).toHaveClass(/graph-selected/);
  await expect(hideWrite).toHaveAttribute("aria-expanded", "true");
  await expect.poll(nodesFit).toBe(true);
  await writeEndpoint.click();
  await expect(dataConnection).toBeVisible();
  await handlerConnection.click();
  await expect(writeHandler).toHaveClass(/graph-selected/);
  await hideWrite.click();
  await expect(writeEndpoint).toHaveClass(/graph-selected/);

  await requestConnection.click();
  const request = graph.getByLabel("Send POST Request, fetch, HTTP Request", {
    exact: true,
  });
  await expect(request).toHaveClass(/graph-selected/);
  await expect(request).toBeInViewport({ ratio: 0.9 });
  await expect.poll(nodesFit).toBe(true);
  await event
    .getByRole("button", { name: "Hide call steps for form.onSubmit" })
    .click();
  await expect(event).toHaveClass(/graph-selected/);
  await selection.getByRole("button", { name: "Clear selection" }).click();
  await expect(empty).toBeVisible();
  await fitAll.click();
  await expect.poll(nodesFit).toBe(true);
  await expect.poll(() => effectiveTitleSize(event)).toBeGreaterThanOrEqual(16);

  const zoomBeforeExpansion = await readZoom();
  await showWrite.click();
  await expect(hideWrite).toHaveAttribute("aria-expanded", "true");
  await expect(writeHandler).toBeVisible();
  await expect(writeService).toBeVisible();
  await expect(readService).toHaveCount(0);
  await expect(submitHandler).toHaveCount(0);
  await expect(writeHandler).toBeInViewport({ ratio: 0.9 });
  await expect(layers).toHaveCount(4);
  await expect(writeEndpoint.locator(".react-flow__handle-bottom")).toHaveCount(
    1,
  );
  const [endpointBox, handlerBox] = await Promise.all(
    [writeEndpoint, writeHandler].map((node) => node.boundingBox()),
  );
  assert.equal(Math.round(handlerBox.x), Math.round(endpointBox.x));
  assert.ok(handlerBox.y > endpointBox.y + endpointBox.height);
  for (const toggle of [showRead, hideWrite]) {
    await expect
      .poll(() =>
        toggle.evaluate(
          (button) =>
            button.parentElement.scrollWidth <=
            button.parentElement.clientWidth,
        ),
      )
      .toBe(true);
  }
  await expect.poll(nodesFit).toBe(true);
  await expect.poll(readZoom).toBeLessThan(zoomBeforeExpansion);
  await expect.poll(canvasHeight).toBe(desktopCanvasHeight);
  const zoomAfterExpansion = await readZoom();
  const beforePan = await readTransform();
  await canvas.hover({ position: { x: 110, y: 240 } });
  await page.mouse.wheel(0, 220);
  await expect.poll(readTransform).not.toBe(beforePan);
  await expect.poll(readZoom).toBeCloseTo(zoomAfterExpansion);
  const cardPosition = () =>
    writeService.evaluate((node) => node.style.transform);
  const lockedPosition = await cardPosition();
  const beforeDrag = await readTransform();
  const serviceBox = await writeService.boundingBox();
  await page.mouse.move(serviceBox.x + 40, serviceBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(serviceBox.x + 160, serviceBox.y + 80, { steps: 6 });
  await page.mouse.up();
  await expect.poll(readTransform).not.toBe(beforeDrag);
  assert.equal(await cardPosition(), lockedPosition);
  await fitAll.click();
  await expect.poll(nodesFit).toBe(true);

  const edge = async (sourceId, target) => {
    const targetId = await target.getAttribute("data-id");
    const id = JSON.stringify([sourceId, targetId]);
    return graph.locator(`.react-flow__edge[data-id=${JSON.stringify(id)}]`);
  };
  await expect(await edge(writeId, writeHandler)).toHaveCount(1);
  await expect(
    await edge(await writeHandler.getAttribute("data-id"), writeService),
  ).toHaveCount(1);
  await expect(await edge(readId, model)).toHaveCount(1);

  await showRead.click();
  await expect(hideRead).toHaveAttribute("aria-expanded", "true");
  await expect(readService).toBeVisible();
  await expect(writeService).toBeVisible();
  await expect(submitHandler).toHaveCount(0);
  await expect.poll(nodesFit).toBe(true);
  await event
    .getByRole("button", { name: "Show call steps for form.onSubmit" })
    .click();
  await expect(submitHandler).toBeVisible();
  await expect.poll(nodesFit).toBe(true);
  await event
    .getByRole("button", { name: "Hide call steps for form.onSubmit" })
    .click();
  await expect(submitHandler).toHaveCount(0);
  await expect.poll(nodesFit).toBe(true);

  await writeService.click();
  await expect(writeService).toHaveClass(/graph-selected/);
  await expect.poll(nodesFit).toBe(true);
  await expect(
    selection.getByText("services/orders.ts:2", { exact: true }),
  ).toBeVisible();
  await expect(
    selection.getByText("app/api/orders/route.ts:4", { exact: true }),
  ).toHaveCount(0);
  await detailedTrace.click();
  await expect(
    selection.getByText("app/api/orders/route.ts:4", { exact: true }),
  ).toBeVisible();
  await hideWrite.click();
  await expect(writeService).toHaveCount(0);
  await expect(writeHandler).toHaveCount(0);
  await expect(readService).toBeVisible();
  await expect(hideRead).toHaveAttribute("aria-expanded", "true");
  await expect(writeEndpoint).toHaveClass(/graph-selected/);
  await expect(
    selection
      .getByRole("paragraph")
      .filter({ hasText: /^POST \/api\/orders$/ }),
  ).toBeVisible();
  await expect(
    selection.getByText("app/api/orders/route.ts:2", { exact: true }),
  ).toBeVisible();
  await expect.poll(nodesFit).toBe(true);
  await expect(writeEndpoint).toBeInViewport({ ratio: 0.9 });

  await hideRead.click();
  await expect(readService).toHaveCount(0);
  await expect(nodes).toHaveCount(4);
  await graph.getByRole("button", { name: "Readable zoom" }).click();
  await expect.poll(readZoom).toBeGreaterThan(1);
  const zoomBeforeResize = await readZoom();
  await page.setViewportSize({ width: 1100, height: 780 });
  await expect(event.locator(".react-flow__handle-bottom")).toHaveCount(1);
  await expect.poll(spaceBelowCanvas).toBeCloseTo(24);
  await expect.poll(readZoom).toBeCloseTo(zoomBeforeResize);
  await expect(
    overview.getByRole("heading", { name: "Create Order" }),
  ).toBeVisible();
  await expect(writeEndpoint).toBeInViewport({ ratio: 0.9 });
  await selection.getByRole("button", { name: "Clear selection" }).click();
  await fitAll.click();
  await expect.poll(nodesFit).toBe(true);
  await readEndpoint.press("Enter");
  await expect(
    selection.getByRole("heading", { name: "List Orders", exact: true }),
  ).toBeVisible();
  await readEndpoint.press("Escape");
  await expect(empty).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(event.locator(".react-flow__handle-bottom")).toHaveCount(1);
  await expect.poll(spaceBelowCanvas).toBeCloseTo(16);
  const mobileCanvasHeight = await canvasHeight();
  await expect
    .poll(() =>
      writeEndpoint
        .locator(".operation-node-identifier")
        .evaluate((title) => title.scrollWidth <= title.clientWidth),
    )
    .toBe(true);
  await expect.poll(() => effectiveTitleSize(event)).toBeGreaterThanOrEqual(14);
  await expect
    .poll(() =>
      page.evaluate(() => globalThis.document.documentElement.scrollWidth),
    )
    .toBe(390);
  await showWrite.click();
  await expect(writeHandler).toBeInViewport({ ratio: 0.9 });
  await expect.poll(nodesFit).toBe(true);
  await expect.poll(canvasHeight).toBe(mobileCanvasHeight);
  await hideWrite.click();
  await expect(nodes).toHaveCount(4);
  await writeEndpoint.press("Enter");
  await expect(
    overview.getByRole("heading", { name: "Create Order" }),
  ).toBeVisible();
  await expect.poll(canvasHeight).toBeGreaterThanOrEqual(mobileCanvasHeight);
  await expect
    .poll(() =>
      panelViewport.evaluate(
        (viewport) => viewport.scrollHeight > viewport.clientHeight,
      ),
    )
    .toBe(true);
  await detailedTrace.click();
  await expect(
    selection.getByText("app/api/orders/route.ts:4", { exact: true }),
  ).toBeVisible();
  await expect(writeEndpoint).toHaveClass(/graph-selected/);

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Orders", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Features", exact: true }),
  ).toBeVisible();
  assert.deepEqual(errors, [], "browser runtime errors");
  console.log(
    "PASS: Chromium verified the Orders layout, viewport, filtering, and selection details on desktop and mobile.",
  );
} finally {
  try {
    await browser?.close();
    if (server)
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
