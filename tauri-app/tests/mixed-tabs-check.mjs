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
  const tabBar = page.locator('[data-testid="tab-bar"]');
  await tabBar.waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);

  const tabs = await tabBar.innerText();
  assert.match(tabs, /XML/);
  assert.match(tabs, /MD/);
  assert.match(tabs, /markdown-test\.md/);
  assert.match(tabs, /generic\.xml/);

  await tabBar.locator('[role="tab"]', { hasText: "generic.xml" }).click();
  await page.locator('[data-testid="generic-xml-view"]').waitFor();
  await page.getByText("通用 XML 预览", { exact: true }).waitFor();

  const screenshot = path.join(outputDir, "mixed-xml-markdown-tabs-1440x900.png");
  await page.screenshot({ path: screenshot, fullPage: true });

  await tabBar.locator('[role="tab"]', { hasText: "markdown-test.md" }).click();
  await page.locator('[data-testid="markdown-view"]').waitFor();

  console.log(JSON.stringify({ ok: true, tabs, screenshot }, null, 2));
} finally {
  await browser.close();
}
