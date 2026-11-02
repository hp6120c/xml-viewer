import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "playwright";

export async function connectTauriPage() {
  const cdpUrl = process.env.TAURI_CDP_URL ?? "http://127.0.0.1:9222";
  const browser = await chromium.connectOverCDP(cdpUrl);
  const page = browser.contexts()[0]?.pages()[0];
  assert(page, "Tauri WebView2 page was not found");
  return { browser, page };
}

export async function openFixtureSession(page, paths, activePath) {
  await page.evaluate(({ sessionPaths, sessionActivePath }) => {
    localStorage.setItem("xml-viewer-session-v2", JSON.stringify({
      paths: sessionPaths,
      activePath: sessionActivePath,
      zoom: 100,
    }));
  }, {
    sessionPaths: paths,
    sessionActivePath: activePath,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="app"]').waitFor({ timeout: 20000 });
}

export function fixturePath(...parts) {
  return path.resolve("..", "..", "e2e-fixtures", ...parts);
}
