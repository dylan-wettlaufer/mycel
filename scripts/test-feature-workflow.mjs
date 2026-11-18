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
  const nodes = graph.locator(".react-flow__node");
  await expect(nodes).toHaveCount(4);
  await expect(event).toBeVisible();
  await expect(readEndpoint).toBeVisible();
  await expect(writeEndpoint).toBeVisible();
  await expect(model).toBeVisible();
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
  const transformBefore = await readTransform();
  const nodesFit = () =>
    graph.locator(".graph-canvas").evaluate((canvas) => {
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
  await showWrite.click();
  await expect(hideWrite).toHaveAttribute("aria-expanded", "true");
  await expect(writeHandler).toBeVisible();
  await expect(writeService).toBeVisible();
  await expect(readService).toHaveCount(0);
  await expect(submitHandler).toHaveCount(0);
  await expect.poll(readTransform).not.toBe(transformBefore);
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

  await writeService.click();
  await expect(writeService).toHaveClass(/graph-selected/);
  const selection = graph.getByRole("complementary", {
    name: "Selection details",
  });
  await expect(
    selection.getByText("services/orders.ts:2", { exact: true }),
  ).toBeVisible();
  await expect(
    selection.getByText("app/api/orders/route.ts:4", { exact: true }),
  ).toBeVisible();
  const beforeCollapse = await readTransform();
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
    selection.getByText("app/api/orders/route.ts:4", { exact: true }),
  ).toBeVisible();
  await expect.poll(readTransform).toBe(beforeCollapse);

  await hideRead.click();
  await expect(readService).toHaveCount(0);
  await expect(nodes).toHaveCount(4);
  await selection.getByRole("button", { name: "Clear selection" }).click();
  await readEndpoint.press("Enter");
  await expect(
    selection.getByRole("heading", { name: "List Orders", exact: true }),
  ).toBeVisible();
  await readEndpoint.press("Escape");
  await expect(selection).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(event.locator(".react-flow__handle-bottom")).toHaveCount(1);
  await expect
    .poll(() =>
      writeEndpoint
        .locator(".operation-node-identifier")
        .evaluate((title) => title.scrollWidth <= title.clientWidth),
    )
    .toBe(true);
  await expect.poll(() => effectiveTitleSize(event)).toBeGreaterThanOrEqual(13);
  await expect
    .poll(() =>
      page.evaluate(() => globalThis.document.documentElement.scrollWidth),
    )
    .toBe(390);
  await showWrite.click();
  await expect(writeService).toBeVisible();
  await expect.poll(nodesFit).toBe(true);
  await hideWrite.click();
  await expect(nodes).toHaveCount(4);

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
    "PASS: Chromium fit expanded Orders graphs on desktop and mobile and verified independent regions and source evidence.",
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
