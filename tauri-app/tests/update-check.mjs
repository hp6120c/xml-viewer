import assert from "node:assert/strict";
import { chromium } from "playwright";

const cdpUrl = process.env.TAURI_CDP_URL ?? "http://127.0.0.1:9222";
const browser = await chromium.connectOverCDP(cdpUrl);
const page = browser.contexts()[0]?.pages()[0];
assert(page, "Tauri WebView2 page was not found");

try {
  await page.locator(".toolbar", { hasText: "检查更新" }).waitFor({ timeout: 15000 });
  await page.locator(".toolbar .tool-button", { hasText: "检查更新" }).click();
  await page.getByText("当前已是最新版本", { exact: true }).waitFor({ timeout: 20000 });
  console.log(JSON.stringify({ ok: true, message: "当前已是最新版本" }));
} finally {
  await browser.close();
}
