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
    paths: ["demo://README.md"],
    activePath: "demo://README.md",
    zoom: 100,
  }));
});

try {
  await page.goto("http://localhost:1420", { waitUntil: "networkidle" });
  await page.locator('[data-testid="muya-markdown-editor"]').waitFor({ timeout: 30000 });
  await page.locator(".mu-table-inner").first().waitFor();

  const cell = page.locator(".mu-table-inner td").first();
  const box = await cell.boundingBox();
  assert(box, "Table cell has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y - 10);
  await page.waitForTimeout(900);
  const toolbar = page.locator(".mu-table-column-tools-container");
  await toolbar.waitFor({ state: "visible", timeout: 5000 });

  const metrics = await page.evaluate(() => {
    const toolbar = document.querySelector(".mu-table-column-tools-container");
    const item = document.querySelector(".mu-table-column-tools li.item");
    const icon = document.querySelector(".mu-table-column-tools li.item .icon-wrapper i.icon > i");
    if (!(toolbar instanceof HTMLElement) || !(item instanceof HTMLElement) || !(icon instanceof HTMLElement)) {
      throw new Error("Table toolbar elements not found");
    }
    const toolbarStyle = getComputedStyle(toolbar);
    const iconStyle = getComputedStyle(icon);
    return {
      backgroundColor: toolbarStyle.backgroundColor,
      borderTopWidth: toolbarStyle.borderTopWidth,
      boxShadow: toolbarStyle.boxShadow,
      opacity: toolbarStyle.opacity,
      iconFilter: iconStyle.filter,
    };
  });

  assert.equal(metrics.backgroundColor, "rgb(255, 255, 255)");
  assert.equal(metrics.borderTopWidth, "1px");
  assert.notEqual(metrics.boxShadow, "none");
  assert.equal(metrics.opacity, "1");
  assert.match(metrics.iconFilter, /rgb\(51,\s*65,\s*85\)/);

  await page.locator(".mu-table-column-tools li.item").first().hover();
  await page.waitForTimeout(150);
  const hoverBackground = await page.locator(".mu-table-column-tools li.item").first().evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  assert.equal(hoverBackground, "rgb(232, 238, 245)");

  const screenshot = path.join(outputDir, "muya-table-toolbar-light-1440x900.png");
  await page.screenshot({ path: screenshot, fullPage: true });

  await page.evaluate(() => {
    document.querySelector(".muya-markdown-shell")?.classList.add("markdown-theme-dark");
  });
  await page.mouse.move(box.x + box.width / 2, box.y - 10);
  await page.waitForTimeout(500);
  const darkMetrics = await page.evaluate(() => {
    const toolbar = document.querySelector(".mu-table-column-tools-container");
    const icon = document.querySelector(".mu-table-column-tools li.item .icon-wrapper i.icon > i");
    if (!(toolbar instanceof HTMLElement) || !(icon instanceof HTMLElement)) {
      throw new Error("Dark table toolbar elements not found");
    }
    return {
      backgroundColor: getComputedStyle(toolbar).backgroundColor,
      iconFilter: getComputedStyle(icon).filter,
    };
  });
  assert.equal(darkMetrics.backgroundColor, "rgb(30, 41, 59)");
  assert.match(darkMetrics.iconFilter, /rgb\(226,\s*232,\s*240\)/);

  const darkScreenshot = path.join(outputDir, "muya-table-toolbar-dark-1440x900.png");
  await page.screenshot({ path: darkScreenshot, fullPage: true });
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join("; ")}`);

  console.log(JSON.stringify({ ok: true, metrics, darkMetrics, hoverBackground, screenshot, darkScreenshot }, null, 2));
} finally {
  await browser.close();
}