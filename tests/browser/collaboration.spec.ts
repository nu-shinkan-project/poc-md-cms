import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
const origin = "http://127.0.0.1:8790";
const state = `.wrangler/browser-${Date.now()}`;
let server: ChildProcess;
let output = "";
async function start() {
  server = spawn(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "dev",
      "--env",
      "",
      "--ip",
      "127.0.0.1",
      "--port",
      "8790",
      "--persist-to",
      state,
    ],
    {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );
  server.stdout!.on("data", (d) => {
    output += d;
  });
  server.stderr!.on("data", (d) => {
    output += d;
  });
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(origin + "/api/documents")).status;
        } catch {
          return 0;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(200);
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    server.once("exit", () => resolve()),
  );
  process.kill(-server.pid!, "SIGTERM");
  await exited;
}
async function edit(page: Page, path = "README.md") {
  await page.goto("/#" + encodeURIComponent(path));
  await page.getByRole("button", { name: "Edit collaboratively" }).click();
  await expect(page.locator(".tiptap")).toBeVisible();
  await expect(page.locator("#status")).toHaveText("Connected · shared draft");
}
async function append(page: Page, text: string) {
  await page.locator(".tiptap").click();
  await page.keyboard.press("Control+End");
  // Let native selectionchange reach ProseMirror before the next key command.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.keyboard.press("Enter");
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.keyboard.type(text);
}
test.beforeAll(start);
test.afterAll(async () => {
  await stop();
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/worker-browser.log", output);
});
test("two independent browsers converge, reconnect, reload, publish and survive Worker restart", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  const first = await a.newPage(),
    second = await b.newPage();
  const errors: string[] = [];
  first.on("pageerror", (error) => errors.push(error.message));
  second.on("pageerror", (error) => errors.push(error.message));
  await Promise.all([edit(first), edit(second)]);
  await expect(first.locator(".tiptap h1")).toHaveCount(1);
  await append(first, "Alice live edit");
  await expect(second.locator(".tiptap")).toContainText("Alice live edit");
  await append(second, "Bob live edit");
  await expect(first.locator(".tiptap")).toContainText("Bob live edit");
  // Disconnect both contexts to make causally concurrent edits to the same shared document.
  await Promise.all([a.setOffline(true), b.setOffline(true)]);
  await Promise.all([
    append(first, "ALPHA concurrent"),
    append(second, "BETA concurrent"),
  ]);
  await Promise.all([a.setOffline(false), b.setOffline(false)]);
  await expect(first.locator(".tiptap")).toContainText("BETA concurrent");
  await expect(second.locator(".tiptap")).toContainText("ALPHA concurrent");
  await expect
    .poll(
      async () =>
        (await first.locator(".tiptap").innerText()) ===
        (await second.locator(".tiptap").innerText()),
    )
    .toBe(true);
  const shared = await first.locator(".tiptap").innerText();
  await first.reload();
  await first.getByRole("button", { name: "Edit collaboratively" }).click();
  await expect(first.locator(".tiptap")).toHaveText(shared, {
    useInnerText: true,
  });
  await first
    .getByRole("button", { name: "Markdown snapshot", exact: true })
    .click();
  const source = await first
    .getByRole("textbox", { name: "Markdown snapshot" })
    .inputValue();
  expect(source).toContain("title: Demo documentation");
  expect(source).toContain("ALPHA concurrent");
  expect(source).toContain("BETA concurrent");
  const stale = await first.request.post(
    "/api/draft?path=README.md&action=publish",
    { headers: { Origin: origin }, data: { expectedMarkdown: "stale" } },
  );
  expect(stale.status()).toBe(409);
  const durable = await first.request.get("/api/draft?path=README.md");
  const snapshot = await durable.json();
  expect(snapshot.markdown).toBe(source);
  expect(snapshot.base.baseCommit).toBe("fixture-base-v1");
  await first.getByRole("button", { name: "Prepare pull request" }).click();
  await expect(first.locator("#publication")).toContainText(
    "Simulated publication",
  );
  const publication = await first.locator("#publication").innerText();
  await first.getByRole("button", { name: "Prepare pull request" }).click();
  await expect(first.locator("#publication")).toHaveText(publication);
  const published = await (
    await first.request.get("/api/document?path=README.md")
  ).json();
  expect(published.source).not.toContain("ALPHA concurrent");
  await first.screenshot({
    path: "artifacts/collaboration.png",
    fullPage: true,
  });
  // Full local Worker process restart; no connected browser can repopulate server state.
  await a.close();
  await b.close();
  await stop();
  await start();
  const c = await browser.newContext();
  const restored = await c.newPage();
  await edit(restored);
  await expect(restored.locator(".tiptap")).toHaveText(shared, {
    useInnerText: true,
  });
  await restored.getByRole("button", { name: "Prepare pull request" }).click();
  await expect(restored.locator("#publication")).toHaveText(publication);
  expect(errors).toEqual([]);
  await c.close();
});
test("directory navigation, room isolation and request validation", async ({
  page,
}) => {
  await edit(page, "guides/getting-started.md");
  await expect(page.locator(".tiptap")).toContainText("const greeting");
  await expect(page.locator(".tiptap")).not.toContainText("ALPHA concurrent");
  await page.getByRole("button", { name: "Published", exact: true }).click();
  await expect(page.locator("#preview pre")).toContainText("console.log");
  await expect(page.getByRole("navigation")).toContainText("guides");
  expect(
    (
      await page.request.post("/api/draft?path=README.md&action=publish")
    ).status(),
  ).toBe(403);
  expect(
    (await page.request.get("/api/draft?path=../secret.md")).status(),
  ).toBe(400);
  expect((await page.request.get("/parties/draft/bad-room")).status()).toBe(
    400,
  );
});
