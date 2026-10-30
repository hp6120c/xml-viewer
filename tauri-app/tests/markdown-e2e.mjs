import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const cdpUrl = process.env.TAURI_CDP_URL ?? "http://127.0.0.1:9222";
const testFile = process.env.MD_E2E_FILE;
assert(testFile, "MD_E2E_FILE is required");

const browser = await chromium.connectOverCDP(cdpUrl);
const context = browser.contexts()[0];
assert(context, "Tauri WebView2 context was not found");
const page = context.pages()[0];
assert(page, "Tauri WebView2 page was not found");
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));

try {
  await page.locator('[data-testid="markdown-view"]').waitFor({ timeout: 15000 });
  const viewText = await page.locator('[data-testid="markdown-view"]').innerText();
  assert.match(viewText, /MD Reader/);
  assert.match(viewText, /主要特性/);

  const title = await page.title();
  assert.match(title, /数据库设计查看器|XML \/ Markdown/);

  const tabText = await page.locator('[data-testid="tab-bar"]').innerText();
  assert.match(tabText, /MD/);
  assert.match(tabText, /markdown-test\.md/);

  await page.locator(".toolbar .tool-button", { hasText: "编辑模式" }).click();
  await page.locator('[data-testid="markdown-editor"]').waitFor();
  await page.locator('[data-testid="markdown-editor"] .cm-content').click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type("# Markdown E2E save test\n\n- editor connected\n- atomic save verified\n");
  await page.locator(".tab-dirty-dot").waitFor({ timeout: 5000 });
  await page.locator(".markdown-edit-page .primary-button").click();
  await page.getByText("Markdown 文档已保存", { exact: true }).waitFor({ timeout: 15000 });
  await page.locator('[data-testid="markdown-view"]').waitFor();

  const saved = await readFile(testFile, "utf8");
  assert.match(saved, /Markdown E2E save test/);
  assert.match(saved, /atomic save verified/);
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join("; ")}`);

  console.log(JSON.stringify({
    ok: true,
    title,
    tabText,
    savedBytes: Buffer.byteLength(saved),
    pageErrors,
  }, null, 2));
} finally {
  await browser.close();
}
