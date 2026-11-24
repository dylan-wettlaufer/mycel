import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  rename,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { startIndexedServer } from "../packages/server/dist/index.js";

const fixture = new URL(
  "../packages/core/test/fixtures/behaviour/",
  import.meta.url,
);
const directory = await mkdtemp(join(tmpdir(), "mycel-relationship-review-"));
const root = join(directory, "orders");
const servicePath = join(root, "services/orders.ts");
let server;
let browser;

try {
  for (const file of await readdir(fixture, { recursive: true })) {
    if (
      !file.endsWith(".txt") ||
      ["Form.tsx.txt", "client.ts.txt"].includes(file)
    )
      continue;
    const target = join(root, file.slice(0, -4));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(new URL(file, fixture), target);
  }
  await mkdir(join(root, "payments"));
  await writeFile(
    join(root, "payments/gateway.ts"),
    "export function authorizePayment() { return true; }\n",
  );
  await mkdir(join(root, ".mycel"));
  await writeFile(
    join(root, ".mycel/architecture.json"),
    JSON.stringify({
      version: 1,
      source: "agent",
      parts: [
        {
          id: "orders",
          name: "Orders",
          purpose: "Accepts orders.",
          kind: "app",
          paths: [
            "app/**",
            "OrderForm.tsx",
            "components/**",
            "submit.ts",
            "services/**",
          ],
        },
        {
          id: "payments",
          name: "Payments",
          purpose: "Authorizes payment.",
          kind: "service",
          paths: ["payments/**"],
        },
        {
          id: "db",
          name: "Persistence",
          purpose: "Stores orders.",
          kind: "data",
          paths: ["db/**"],
        },
      ],
    }),
  );
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe", encoding: "utf8" });
  git("init", "-b", "main");
  git("add", ".");
  git(
    "-c",
    "user.email=review@example.test",
    "-c",
    "user.name=Mycel Test",
    "commit",
    "-m",
    "Initial fixture",
  );
  git("checkout", "-b", "review/payments");

  server = await startIndexedServer(0, {
    project: { name: "orders", root },
    databasePath: join(directory, "index.sqlite"),
  });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base);
  await expect(page.getByText("Live updates", { exact: true })).toBeVisible();
  await page.getByTestId("rf__node-orders").click();
  const relationshipReview = page.getByText("Recent relationship changes", {
    exact: true,
  });
  await expect(relationshipReview).toBeVisible();
  await expect(
    page.getByText("No relationship changes in the last 7 days"),
  ).toBeVisible();
  await relationshipReview.click();
  await expect(
    page.getByRole("link", { name: "View relationship activity" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "View relationship activity" }).click();
  await expect(
    page.getByRole("heading", { name: "No call or import changes recorded" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Load older changes" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Browse file changes" }).click();
  await expect(
    page.getByRole("heading", { name: "No file edits recorded yet" }),
  ).toBeVisible();
  await page.goto(base);
  await page.getByTestId("rf__node-orders").click();
  const liveEdge = page.locator(
    '.react-flow__edge[aria-label="Edge from orders to payments"]',
  );
  await expect(liveEdge).toHaveCount(0);

  const original = await readFile(servicePath, "utf8");
  const imported =
    "import { authorizePayment } from '../payments/gateway';\n" + original;
  const called = imported.replace(
    "  return database.order.create",
    "  authorizePayment();\n  return database.order.create",
  );
  await writeFile(servicePath, called);
  // The new edge has one import and one call and must appear without showing minor connections.
  await expect(liveEdge).toHaveCount(1);
  await expect(liveEdge.locator(".react-flow__edge-path")).toHaveCSS(
    "stroke-width",
    "2px",
  );
  const added = "Orders now calls Payments through authorizePayment()";
  await expect(page.getByText(added, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show minor connections (1)" }),
  ).toHaveAttribute("aria-pressed", "false");

  const sidebar = page.getByRole("complementary", {
    name: "Selection details",
  });
  await sidebar.getByRole("button", { name: /Payments/ }).click();
  const evidence = sidebar.getByRole("region", { name: "Connection evidence" });
  await evidence
    .getByRole("button", { name: /Line 4 · call · authorizePayment/ })
    .click();
  const source = sidebar.getByRole("region", { name: "Source code" });
  await expect(source.getByRole("heading")).toHaveText("services/orders.ts:4");
  await expect(source.locator(".view-lines")).toContainText(
    "authorizePayment();",
  );
  const oldSource = await page.request.get(
    `${base}/api/files/content?path=services%2Forders.ts`,
  );
  const { revision } = await oldSource.json();
  const shiftedHeader =
    "// Move the call without changing the relationship.\n\n\n";
  await writeFile(servicePath, shiftedHeader + called);
  await expect(source.getByRole("heading")).toHaveText("services/orders.ts:7");
  await expect(source.locator(".view-lines")).toContainText(
    "authorizePayment();",
  );
  const pinned = await page.request.get(
    `${base}/api/files/content?path=services%2Forders.ts&revision=${revision}`,
  );
  expect(await pinned.json()).toMatchObject({ revision, content: called });

  await page.getByText("Recent relationship changes", { exact: true }).click();
  await page.getByRole("link", { name: /Orders now calls Payments/ }).click();
  await expect(
    page.getByRole("button", { name: "Relationships", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/including uncommitted edits/)).toBeVisible();
  expect(git("status", "--short")).toContain("M services/orders.ts");
  await expect(
    page.getByRole("region", { name: "Recorded source diff" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open added call at line 4" }).click();
  await expect(
    page
      .getByRole("region", { name: "Recorded source", exact: true })
      .locator(".view-lines"),
  ).toContainText("authorizePayment();");

  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Graph", exact: true })
    .click();
  await page.getByTestId("rf__node-orders").click();
  await sidebar.getByRole("button", { name: /Payments/ }).click();
  await evidence
    .getByRole("button", { name: /Line 7 · call · authorizePayment/ })
    .click();
  await writeFile(servicePath, shiftedHeader + imported);
  await expect(
    sidebar.getByText("This call was removed from the live graph."),
  ).toBeVisible();
  await expect(liveEdge).toHaveCount(1);
  const removed = sidebar.getByRole("link", {
    name: /Orders no longer calls Payments/,
  });
  await expect(removed).toBeVisible();
  const removalUrl = await removed.getAttribute("href");

  await Promise.all([
    writeFile(servicePath, original),
    unlink(join(root, "payments/gateway.ts")),
  ]);
  await expect(liveEdge).toHaveCount(0);
  await expect(
    sidebar.getByRole("heading", { name: "Connection removed" }),
  ).toBeVisible();
  await expect(
    sidebar.getByRole("link", { name: /Orders no longer imports Payments/ }),
  ).toBeVisible();
  await page.goto(`${base}/${removalUrl}`);
  await expect(
    page.getByRole("region", { name: "Recorded source diff" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open removed call at line 7" })
    .click();
  const old = page.getByRole("region", {
    name: "Recorded source",
    exact: true,
  });
  await expect(old.getByRole("heading")).toContainText("services/orders.ts:7");
  await expect(old.locator(".view-lines")).toContainText("authorizePayment();");

  await page.goto(base);
  await page.getByTestId("rf__node-orders").click();
  await sidebar.getByRole("button", { name: "Walk through a flow" }).click();
  const flow = sidebar.getByRole("region", { name: "Flow walkthrough" });
  const submit = flow.getByRole("button", { name: /Trace .*onSubmit/ });
  await submit.click();
  await expect(
    flow.getByText("Handle POST Request", { exact: true }),
  ).toBeVisible();
  await expect(
    flow.getByText("Create Order Record", { exact: true }),
  ).toBeVisible();
  const postPath = flow
    .getByRole("region", { name: /Trace path/ })
    .filter({ hasText: "Create Order Record" });
  await expect(
    postPath.getByText("Reached a persistence operation."),
  ).toBeVisible();
  await flow
    .getByRole("button", { name: "View source for Handle POST Request" })
    .click();
  await expect(
    flow.getByRole("region", { name: "Source code" }).getByRole("heading"),
  ).toHaveText(/app\/api\/orders\/route.ts:\d+/);
  await flow.getByRole("button", { name: "Back to flow" }).click();
  await expect(
    sidebar.getByRole("heading", { name: "Orders", exact: true }),
  ).toBeVisible();
  await expect(submit).toHaveAttribute("aria-pressed", "true");
  await flow
    .getByRole("button", { name: "View source for Create Order Record" })
    .click();
  await expect(
    flow.getByRole("region", { name: "Source code" }).getByRole("heading"),
  ).toHaveText(/services\/orders.ts:\d+/);
  await flow.getByRole("button", { name: "Back to flow" }).click();

  await writeFile(
    join(root, "payments/gateway.ts"),
    "export function authorizePayment() {}\n",
  );
  await mkdir(join(root, "components"));
  await rename(
    join(root, "OrderForm.tsx"),
    join(root, "components/OrderForm.tsx"),
  );
  const moved = join(root, "components/OrderForm.tsx");
  await writeFile(
    moved,
    (await readFile(moved, "utf8")).replace(
      "from './submit'",
      "from '../submit'",
    ),
  );
  const pagePath = join(root, "app/orders/page.tsx");
  await writeFile(
    pagePath,
    (await readFile(pagePath, "utf8")).replace(
      "../../OrderForm",
      "../../components/OrderForm",
    ),
  );
  const proposalFile = join(root, ".mycel/agent-proposals.json");
  await writeFile(
    proposalFile,
    JSON.stringify({
      version: 1,
      proposals: [
        {
          part: "orders",
          agent: "Fixture agent",
          label: "Order submission",
          path: "components/OrderForm.tsx",
          line: 10,
          calls: "payments",
        },
      ],
    }),
  );
  await expect(
    sidebar.getByRole("heading", { name: "Orders", exact: true }),
  ).toBeVisible();
  await expect(submit).toContainText("components/OrderForm.tsx");
  await expect(
    flow.getByText("Source matched", { exact: false }),
  ).toBeVisible();
  await expect(
    flow.getByText("Unsupported call claim to payments"),
  ).toBeVisible();
  await expect(liveEdge).toHaveCount(0);
  await submit.click();
  await expect(
    flow.getByText("Create Order Record", { exact: true }),
  ).toBeVisible();

  const schemaPath = join(root, "prisma/schema.prisma");
  const schema = await readFile(schemaPath, "utf8");
  const health = async () => (await fetch(`${base}/api/health`)).json();
  const beforeSchemaChange = (await health()).index.revision;
  await writeFile(
    schemaPath,
    schema.replace("model Order {", "model Purchase {"),
  );
  await expect
    .poll(async () => (await health()).index.revision)
    .toBeGreaterThan(beforeSchemaChange);
  await expect(
    flow.getByText("Create Order Record", { exact: true }),
  ).toHaveCount(0);
  await expect(submit).toHaveAttribute("aria-pressed", "true");
  await expect(
    flow.getByText("Handle POST Request", { exact: true }),
  ).toBeVisible();
  await writeFile(schemaPath, schema);
  await expect(
    flow.getByText("Create Order Record", { exact: true }),
  ).toBeVisible();

  const requestPath = join(root, "submit.ts");
  const request = await readFile(requestPath, "utf8");
  await writeFile(
    requestPath,
    request.replaceAll("fetch('/api/orders'", "fetch(String('/api/orders')"),
  );
  await expect(
    flow
      .getByText("Tracing stopped at an unsupported step.", { exact: false })
      .first(),
  ).toBeVisible();

  console.log("PASS: relationship changes, live source, and review workflow");
} finally {
  await browser?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await rm(directory, { recursive: true, force: true });
}
