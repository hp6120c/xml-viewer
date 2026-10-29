import assert from "node:assert/strict";
import { unlink, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const cdpUrl = process.env.TAURI_CDP_URL ?? "http://127.0.0.1:9222";
const outputDir = path.resolve("..", "..", "outputs");
const file = path.join(outputDir, `new-file-check-${Date.now()}.md`);
const browser = await chromium.connectOverCDP(cdpUrl);
const page = browser.contexts()[0]?.pages()[0];
assert(page, "Tauri WebView2 page was not found");

try {
  const result = await page.evaluate(async (target) => {
    return window.__TAURI_INTERNALS__.invoke("create_document_file", {
      path: target,
      kind: "markdown",
    });
  }, file);
  assert.equal(result, null);
  const content = await readFile(file, "utf8");
  assert.match(content, /^# 未命名文档/);
  console.log(JSON.stringify({ ok: true, file, bytes: content.length }));
} finally {
  await unlink(file).catch(() => undefined);
  await browser.close();
}
