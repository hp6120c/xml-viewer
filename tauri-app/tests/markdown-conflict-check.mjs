import assert from "node:assert/strict";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const cdpUrl = process.env.TAURI_CDP_URL ?? "http://127.0.0.1:9222";
const testFile = process.env.MD_E2E_FILE;
const sourceFile = process.env.MD_E2E_SOURCE;
assert(testFile, "MD_E2E_FILE is required");
assert(sourceFile, "MD_E2E_SOURCE is required");

const browser = await chromium.connectOverCDP(cdpUrl);
const page = browser.contexts()[0]?.pages()[0];
assert(page, "Tauri WebView2 page was not found");

try {
  await page.locator('[data-testid="markdown-view"]').waitFor({ timeout: 15000 });
  await page.locator(".toolbar .tool-button", { hasText: "刷新" }).click();
  await page.getByText("文件已刷新", { exact: true }).waitFor();

  await page.locator(".toolbar .tool-button", { hasText: "编辑模式" }).click();
  await page.locator('[data-testid="markdown-editor"]').waitFor();
  await page.locator('[data-testid="markdown-editor"] .cm-content').click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type("# Local edit\n");
  await page.locator(".tab-dirty-dot").waitFor();

  await writeFile(testFile, "# External edit\n", "utf8");
  await page.locator(".markdown-edit-page .primary-button").click();
  await page.getByText(/Markdown 文件已被其他程序修改/).waitFor({ timeout: 15000 });

  assert.equal(await readFile(testFile, "utf8"), "# External edit\n");
  console.log(JSON.stringify({ ok: true, conflictProtected: true }));
} finally {
  await copyFile(sourceFile, testFile);
  await browser.close();
}
