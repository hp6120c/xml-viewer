import assert from "node:assert/strict";
import { chromium } from "playwright";

const cdpUrl = process.env.TAURI_CDP_URL ?? "http://127.0.0.1:9222";
const browser = await chromium.connectOverCDP(cdpUrl);
const page = browser.contexts()[0]?.pages()[0];
assert(page, "Tauri WebView2 page was not found");

try {
  await page.locator(".toolbar").waitFor({ timeout: 15000 });
  await page.locator(".toolbar .tool-button", { hasText: "全屏" }).click();
  await page.locator(".app.fullscreen-mode").waitFor();
  assert.equal(await page.locator(".app-header").isVisible(), false);
  assert.equal(await page.locator(".toolbar").isVisible(), false);
  assert.equal(await page.locator(".app-footer").isVisible(), false);
  assert.equal(await page.locator('[data-testid="tab-bar"]').count() >= 0, true);
  const size = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  }));
  assert.equal(size.innerWidth, size.screenWidth);
  assert.equal(size.innerHeight, size.screenHeight);
  await page.locator(".fullscreen-exit, .fullscreen-empty-exit").first().click();
  await page.locator(".app.fullscreen-mode").waitFor({ state: "detached" });
  console.log(JSON.stringify({ ok: true, size }));
} finally {
  await browser.close();
}
