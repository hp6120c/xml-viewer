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

  await page.evaluate(() => {
    const body = document.querySelector(".markdown-body");
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.nodeValue?.includes("快速开始")) node = walker.nextNode();
    if (!node) throw new Error("target text not found");
    const start = node.nodeValue.indexOf("快速开始");
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + "快速开始".length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.querySelector(".markdown-view-scroll").dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true }),
    );
  });

  const toolbar = page.locator(".markdown-selection-toolbar");
  await toolbar.waitFor();
  await toolbar.locator("select").first().selectOption("24px");
  await toolbar.locator(".markdown-selection-apply").click();
  const previewFontSize = await page
    .locator(".markdown-body h2", { hasText: "快速开始" })
    .locator("span")
    .evaluate((element) => getComputedStyle(element).fontSize);
  assert.equal(previewFontSize, "24px");
  await page.keyboard.press("Control+E");
  await page.locator('[data-testid="markdown-editor"]').waitFor();

  const editorText = await page.locator('[data-testid="markdown-editor"] .cm-content').innerText();
  assert.match(editorText, /<span style="font-size: 24px">快速开始<\/span>/);
  const screenshot = path.join(outputDir, "markdown-local-style-1440x900.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log(JSON.stringify({ ok: true, previewFontSize, editorText: editorText.slice(0, 260), screenshot }, null, 2));
} finally {
  await browser.close();
}
