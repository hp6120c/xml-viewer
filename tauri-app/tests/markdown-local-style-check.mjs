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

  const selectText = async (needle) => {
    await page.evaluate((target) => {
      const body = document.querySelector(".markdown-body");
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !node.nodeValue?.includes(target)) node = walker.nextNode();
      if (!node) throw new Error("target text not found");
      const start = node.nodeValue.indexOf(target);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + target.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.querySelector(".markdown-view-scroll").dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true }),
      );
    }, needle);
    await page.locator(".markdown-selection-toolbar").waitFor();
  };

  await selectText("快速开始");

  const toolbar = page.locator(".markdown-selection-toolbar");
  const toolbarScreenshot = path.join(outputDir, "markdown-selection-toolbar-1440x900.png");
  await page.screenshot({ path: toolbarScreenshot, fullPage: true });
  await toolbar.locator("select").first().selectOption("24px");
  await toolbar.locator(".markdown-selection-apply").click();
  const previewFontSize = await page
    .locator(".markdown-body h2", { hasText: "快速开始" })
    .locator("span")
    .evaluate((element) => getComputedStyle(element).fontSize);
  assert.equal(previewFontSize, "24px");

  await selectText("快速开始");
  await page.locator(".markdown-selection-toolbar .markdown-selection-icon").first().click();
  await page.locator(".markdown-selection-toolbar .markdown-selection-apply").click();
  const previewFontWeight = await page
    .locator(".markdown-body h2", { hasText: "快速开始" })
    .locator("span")
    .last()
    .evaluate((element) => getComputedStyle(element).fontWeight);
  assert.equal(previewFontWeight, "400");

  await selectText("支持 XML 数据库设计和 Markdown 文档阅读、编辑的桌面工具。");
  await page.locator(".markdown-selection-toolbar select").nth(1).selectOption("serif");
  await page.locator(".markdown-selection-toolbar .markdown-selection-icon").nth(1).click();
  await page.locator(".markdown-selection-toolbar .markdown-selection-icon").nth(2).click();
  await page.locator(".markdown-selection-toolbar .markdown-selection-apply").click();
  const paragraphStyle = await page
    .locator(".markdown-body p", { hasText: "支持 XML 数据库设计" })
    .locator("span")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        fontFamily: style.fontFamily,
        fontStyle: style.fontStyle,
        textDecoration: style.textDecorationLine,
      };
    });
  assert.match(paragraphStyle.fontFamily, /Georgia|Songti|Noto Serif/);
  assert.equal(paragraphStyle.fontStyle, "italic");
  assert.match(paragraphStyle.textDecoration, /underline/);

  await page.keyboard.press("Control+E");
  await page.locator('[data-testid="markdown-editor"]').waitFor();

  const editorText = await page.locator('[data-testid="markdown-editor"] .cm-content').innerText();
  assert.match(editorText, /<span style="font-size: 24px"><span style="font-weight: 400">快速开始<\/span><\/span>/);
  const screenshot = path.join(outputDir, "markdown-local-style-1440x900.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log(JSON.stringify({
    ok: true,
    previewFontSize,
    previewFontWeight,
    paragraphStyle,
    editorText: editorText.slice(0, 260),
    toolbarScreenshot,
    screenshot,
  }, null, 2));
} finally {
  await browser.close();
}
