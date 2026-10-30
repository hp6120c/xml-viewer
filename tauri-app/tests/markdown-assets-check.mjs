import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const cdpUrl = process.env.TAURI_CDP_URL ?? "http://127.0.0.1:9222";
const outputDir = path.resolve("..", "..", "outputs");
await mkdir(outputDir, { recursive: true });
const browser = await chromium.connectOverCDP(cdpUrl);
const page = browser.contexts()[0]?.pages()[0];
assert(page, "Tauri WebView2 page was not found");

try {
  await page.locator('[data-testid="markdown-view"]').waitFor({ timeout: 15000 });
  if (await page.locator('[data-testid="markdown-editor"]').count()) {
    await page.locator(".markdown-edit-page .secondary-button", { hasText: "取消" }).click();
    await page.locator('[data-testid="markdown-view"]').waitFor();
  }
  await page.locator(".toolbar .tool-button", { hasText: "刷新" }).click();
  await page.waitForTimeout(1200);

  const images = page.locator('[data-testid="markdown-view"] img');
  const imageCount = await images.count();
  assert(imageCount >= 3, `expected at least 3 Markdown images, found ${imageCount}`);
  const sources = await images.evaluateAll((items) => items.map((item) => item.getAttribute("src") ?? ""));
  assert(sources.some((source) => source.startsWith("data:image/png;base64,")));
  const screenshot = path.join(outputDir, "markdown-real-document-1440x900.png");
  await page.screenshot({ path: screenshot, fullPage: true });

  console.log(JSON.stringify({
    ok: true,
    imageCount,
    screenshot,
    sources: sources.map((source) => source.slice(0, 22)),
  }, null, 2));
} finally {
  await browser.close();
}
