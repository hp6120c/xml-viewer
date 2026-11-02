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

await page.addInitScript(() => {
  localStorage.setItem("xml-viewer-session-v2", JSON.stringify({
    paths: ["demo://README.md"],
    activePath: "demo://README.md",
    zoom: 100,
  }));
});

try {
  await page.goto("http://localhost:1420", { waitUntil: "networkidle" });
  await page.locator('[data-testid="muya-markdown-editor"]').waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  const body = await page.locator('[data-testid="muya-markdown-editor"]').innerText();
  assert.match(body, /快速开始/);
  assert.match(body, /目录结构/);
  assert.match(body, /XML \/ Markdown 编辑器/);
  await page.getByText("Designed and developed by Austin.H", { exact: true }).waitFor();
  const footerMetrics = await page.evaluate(() => {
    const footer = document.querySelector(".app-footer");
    const author = document.querySelector(".footer-author");
    const header = document.querySelector(".app-header");
    if (!footer || !author || !header) return null;
    const footerRect = footer.getBoundingClientRect();
    const authorRect = author.getBoundingClientRect();
    return {
      authorCenter: authorRect.left + authorRect.width / 2,
      footerCenter: footerRect.left + footerRect.width / 2,
      inFooter: authorRect.top >= footerRect.top && authorRect.bottom <= footerRect.bottom,
      headerContainsAuthor: header.textContent?.includes("Designed and developed by Austin.H"),
    };
  });
  assert(footerMetrics);
  assert.equal(footerMetrics.inFooter, true);
  assert.equal(footerMetrics.headerContainsAuthor, false);
  assert(Math.abs(footerMetrics.authorCenter - footerMetrics.footerCenter) <= 1);
  assert.equal(await page.locator(".muya-font-toolbar").count(), 0);
  assert.equal(await page.locator(".tab-dirty-dot").count(), 0);

  const layouts = {};
  for (const width of [1440, 1280, 1100, 960]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    const metrics = await page.evaluate(() => {
      const root = document.documentElement;
      const pane = document.querySelector('[data-testid="content-pane"]');
      const host = document.querySelector(".muya-markdown-host");
      const container = document.querySelector(".mu-container");
      return {
        horizontalOverflow: root.scrollWidth - root.clientWidth,
        paneWidth: pane?.getBoundingClientRect().width ?? 0,
        hostWidth: host?.getBoundingClientRect().width ?? 0,
        containerWidth: container?.getBoundingClientRect().width ?? 0,
      };
    });
    assert.equal(metrics.horizontalOverflow, 0, `${width}px must not overflow horizontally`);
    assert(Math.abs(metrics.paneWidth - metrics.hostWidth) <= 2);
    assert(metrics.containerWidth >= metrics.hostWidth - 2, `${width}px content must fill the pane`);
    layouts[width] = metrics;
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  const resizer = page.locator(".sidebar-resizer");
  const resizerBox = await resizer.boundingBox();
  assert(resizerBox);
  const sidebarBefore = await page.locator(".workspace").evaluate(
    (element) => getComputedStyle(element).getPropertyValue("--sidebar-width"),
  );
  await page.mouse.move(resizerBox.x + 2, resizerBox.y + 40);
  await page.mouse.down();
  await page.mouse.move(resizerBox.x + 72, resizerBox.y + 40);
  await page.mouse.up();
  const sidebarAfter = await page.locator(".workspace").evaluate(
    (element) => getComputedStyle(element).getPropertyValue("--sidebar-width"),
  );
  assert.notEqual(sidebarAfter, sidebarBefore);

  await page.locator("a.markdown-toc-item", { hasText: "目录结构" }).click();
  await page.waitForTimeout(500);
  assert((await page.locator(".muya-markdown-host").evaluate((node) => node.scrollTop)) > 0);

  const screenshot = path.join(outputDir, "muya-markdown-editor-1440x900.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log(JSON.stringify({
    ok: true,
    screenshot,
    footerMetrics,
    layouts,
    sidebarWidths: { before: sidebarBefore, after: sidebarAfter },
    text: body.slice(0, 500),
  }, null, 2));
} finally {
  await browser.close();
}
