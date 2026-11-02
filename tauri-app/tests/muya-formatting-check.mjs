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
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));

await page.addInitScript(() => {
  localStorage.setItem("xml-viewer-session-v2", JSON.stringify({
    paths: ["demo://README.md"],
    activePath: "demo://README.md",
    zoom: 100,
  }));
});

async function selectText(text) {
  await page.evaluate((selectedText) => {
    const target = Array.from(document.querySelectorAll(".mu-plain-text"))
      .find((element) => element.textContent?.includes(selectedText));
    const textNode = target?.firstChild;
    if (!(textNode instanceof Text)) throw new Error(`Text not found: ${selectedText}`);
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, textNode.textContent?.length ?? 0);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Shift" }));
  }, text);
  await page.locator(".mu-format-picker:visible li.item.strong").waitFor();
}

async function paragraphHtml(text) {
  return page.evaluate((selectedText) => {
    const target = Array.from(document.querySelectorAll(".mu-paragraph-content"))
      .find((element) => element.textContent?.includes(selectedText));
    return target?.innerHTML ?? "";
  }, text);
}

async function clickFormat(type) {
  await page.locator(`.mu-format-picker:visible li.item.${type}`).first().click();
  await page.waitForTimeout(80);
}

try {
  await page.goto("http://localhost:1420", { waitUntil: "networkidle" });
  await page.locator('[data-testid="muya-markdown-editor"]').waitFor({ timeout: 30000 });
  await page.locator(".mu-container").waitFor();

  const text = "支持 XML 数据库设计和 Markdown 文档阅读、编辑的桌面工具。";
  await selectText(text);
  assert.equal(await page.locator(".mu-format-picker:visible li.item.strong").count(), 1);
  assert.equal(await page.locator(".mu-format-picker:visible li.item").count(), 10);
  for (const format of [
    "strong",
    "em",
    "u",
    "del",
    "mark",
    "inline_code",
    "inline_math",
    "link",
    "image",
    "clear",
  ]) {
    assert.equal(
      await page.locator(`.mu-format-picker:visible li.item.${format}`).count(),
      1,
      `native formatting item is missing: ${format}`,
    );
  }

  await clickFormat("strong");
  assert.match(await paragraphHtml(text), /<strong\b/);

  await clickFormat("em");
  assert.match(await paragraphHtml(text), /<em\b/);

  await clickFormat("u");
  assert.match(await paragraphHtml(text), /<u\b/);

  await clickFormat("mark");
  assert.match(await paragraphHtml(text), /<mark\b/);

  await clickFormat("clear");
  const cleared = await paragraphHtml(text);
  assert.doesNotMatch(cleared, /<(?:strong|em|u|mark)\b/);

  await clickFormat("strong");
  assert.match(await paragraphHtml(text), /<strong\b/);
  await clickFormat("strong");
  assert.doesNotMatch(await paragraphHtml(text), /<strong\b/);

  await clickFormat("del");
  assert.match(await paragraphHtml(text), /<(?:del|s)\b/);
  await clickFormat("del");
  assert.doesNotMatch(await paragraphHtml(text), /<(?:del|s)\b/);

  await clickFormat("inline_code");
  assert.match(await paragraphHtml(text), /<code\b/);
  await clickFormat("inline_code");
  assert.doesNotMatch(await paragraphHtml(text), /<code\b/);
  assert.equal(await page.locator(".muya-font-toolbar").count(), 0);

  await selectText(text);
  const toolbarScreenshot = path.join(outputDir, "muya-format-toolbar-1440x900.png");
  await page.screenshot({ path: toolbarScreenshot, fullPage: true });
  assert.equal(await page.locator(".mu-viewer-color-item").count(), 0);
  assert.equal(await page.locator(".mu-viewer-font-controls").count(), 0);

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join("; ")}`);
  console.log(JSON.stringify({
    ok: true,
    formats: [
      "strong",
      "em",
      "u",
      "del",
      "mark",
      "inline_code",
      "clear",
      "strong-toggle",
      "del-toggle",
      "inline-code-toggle",
    ],
    clearedHtml: cleared,
    toolbarScreenshot,
  }, null, 2));
} finally {
  await browser.close();
}
