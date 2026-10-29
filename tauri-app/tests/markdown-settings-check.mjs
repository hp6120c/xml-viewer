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
  localStorage.removeItem("xml-viewer-markdown-reading-settings-v1");
});

try {
  await page.goto("http://localhost:1420", { waitUntil: "networkidle" });
  await page.locator('[data-testid="markdown-view"]').waitFor();
  await page.locator(".toolbar .tool-button", { hasText: "基础样式" }).click();
  await page.locator(".markdown-settings-panel").waitFor();

  await page.locator(".markdown-theme-card.theme-dark").click();
  await page.locator(".markdown-setting-row select").nth(1).selectOption("full");
  await page.locator(".markdown-setting-range input[type='range']").first().fill("19");

  const result = await page.locator('[data-testid="markdown-view"]').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      theme: element.className,
      background: style.getPropertyValue("--md-bg").trim(),
      text: style.getPropertyValue("--md-text").trim(),
      fontSize: style.getPropertyValue("--md-font-size").trim(),
      width: style.getPropertyValue("--md-width").trim(),
    };
  });
  assert.match(result.theme, /markdown-theme-dark/);
  assert.equal(result.background, "#121a23");
  assert.equal(result.text, "#dce8f2");
  assert.equal(result.fontSize, "19px");
  assert.equal(result.width, "none");

  const screenshot = path.join(outputDir, "markdown-style-settings-1440x900.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log(JSON.stringify({ ok: true, result, screenshot }, null, 2));
} finally {
  await browser.close();
}
