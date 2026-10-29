import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const candidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const executablePath = candidates.find((candidate) => existsSync(candidate));
assert(executablePath, "Chrome or Edge executable was not found");

const outputDir = path.resolve("..", "..", "outputs");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));

await page.addInitScript(() => {
  localStorage.setItem("xml-viewer-session-v2", JSON.stringify({
    paths: ["demo://scl_schema_demo.xml", "demo://README.md"],
    activePath: "demo://README.md",
    zoom: 100,
  }));
});

try {
  await page.goto("http://localhost:1420", { waitUntil: "networkidle" });
  await page.locator('[data-testid="markdown-view"]').waitFor();
  await page.locator(".app-header h1", { hasText: "XML / Markdown 编辑器" }).waitFor();
  await page.getByText("文档大纲", { exact: true }).waitFor();
  await page.getByText("Markdown", { exact: true }).first().waitFor();

  const tabBar = page.locator('[data-testid="tab-bar"]');
  assert.match(await tabBar.innerText(), /demo\.xml/);
  assert.match(await tabBar.innerText(), /README\.md/);
  assert.match(await tabBar.innerText(), /XML/);
  assert.match(await tabBar.innerText(), /MD/);

  const layouts = {};
  for (const width of [1440, 1280, 1100, 960]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(120);
    const metrics = await page.evaluate(() => {
      const root = document.documentElement;
      const pane = document.querySelector('[data-testid="content-pane"]');
      const view = document.querySelector('[data-testid="markdown-view"]');
      const paneRect = pane?.getBoundingClientRect();
      const viewRect = view?.getBoundingClientRect();
      return {
        horizontal: root.scrollWidth - root.clientWidth,
        paneWidth: paneRect?.width ?? 0,
        viewWidth: viewRect?.width ?? 0,
      };
    });
    assert.equal(metrics.horizontal, 0, `${width}px page must not overflow horizontally`);
    assert(metrics.paneWidth > 0);
    assert(Math.abs(metrics.paneWidth - metrics.viewWidth) <= 2, `${width}px Markdown view must fill its pane`);
    layouts[width] = metrics;
  }

  await page.setViewportSize({ width: 1440, height: 900 });

  const sidebar = page.locator(".sidebar-resizer");
  const beforeSidebarWidth = await page.evaluate(() =>
    getComputedStyle(document.querySelector(".workspace")).getPropertyValue("--sidebar-width"),
  );
  const resizerBox = await sidebar.boundingBox();
  assert(resizerBox);
  await page.mouse.move(resizerBox.x + 2, resizerBox.y + 40);
  await page.mouse.down();
  await page.mouse.move(resizerBox.x + 82, resizerBox.y + 40);
  await page.mouse.up();
  const afterSidebarWidth = await page.evaluate(() =>
    getComputedStyle(document.querySelector(".workspace")).getPropertyValue("--sidebar-width"),
  );
  assert.notEqual(afterSidebarWidth, beforeSidebarWidth);

  await page.screenshot({
    path: path.join(outputDir, "markdown-preview-1440x900.png"),
    fullPage: true,
  });

  await page.locator('[data-testid="tab-bar"] [role="tab"]', { hasText: "demo.xml" }).click();
  await page.getByText("表目录", { exact: true }).waitFor();
  const xmlSidebar = page.locator(".sidebar-resizer");
  const xmlBefore = await page.evaluate(() =>
    getComputedStyle(document.querySelector(".workspace")).getPropertyValue("--sidebar-width"),
  );
  const xmlResizerBox = await xmlSidebar.boundingBox();
  assert(xmlResizerBox);
  await page.mouse.move(xmlResizerBox.x + 2, xmlResizerBox.y + 40);
  await page.mouse.down();
  await page.mouse.move(xmlResizerBox.x + 60, xmlResizerBox.y + 40);
  await page.mouse.up();
  const xmlAfter = await page.evaluate(() =>
    getComputedStyle(document.querySelector(".workspace")).getPropertyValue("--sidebar-width"),
  );
  assert.notEqual(xmlAfter, xmlBefore);
  await page.locator('[data-testid="tab-bar"] [role="tab"]', { hasText: "README.md" }).click();
  await page.locator('[data-testid="markdown-view"]').waitFor();

  await page.locator(".toolbar .tool-button", { hasText: "编辑模式" }).click();
  await page.locator('[data-testid="markdown-editor"]').waitFor();
  await page.screenshot({
    path: path.join(outputDir, "markdown-editor-1440x900.png"),
    fullPage: true,
  });

  await page.locator(".toolbar .tool-button", { hasText: "全屏" }).click();
  await page.locator(".app.fullscreen-mode").waitFor();
  assert.equal(await page.locator(".app-header").isVisible(), false);
  assert.equal(await page.locator(".toolbar").isVisible(), false);
  assert.equal(await page.locator('[data-testid="tab-bar"]').isVisible(), true);
  const fullscreenScreenshot = path.join(outputDir, "markdown-fullscreen-1440x900.png");
  await page.screenshot({ path: fullscreenScreenshot, fullPage: true });
  await page.locator(".fullscreen-exit").click();
  await page.locator(".app.fullscreen-mode").waitFor({ state: "detached" });
  assert.equal(await page.locator(".app-header").isVisible(), true);

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join("; ")}`);
  console.log(JSON.stringify({
    ok: true,
    layouts,
    sidebarWidths: {
      markdown: { before: beforeSidebarWidth, after: afterSidebarWidth },
      xml: { before: xmlBefore, after: xmlAfter },
    },
    tabs: await tabBar.innerText(),
    screenshots: [
      path.join(outputDir, "markdown-preview-1440x900.png"),
      path.join(outputDir, "markdown-editor-1440x900.png"),
      fullscreenScreenshot,
    ],
  }, null, 2));
} finally {
  await browser.close();
}
