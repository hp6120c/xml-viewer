import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const candidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const executablePath = candidates.find((candidate) => existsSync(candidate));
assert(executablePath, "Chrome or Edge executable was not found");

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

try {
  await page.goto("http://localhost:1420", { waitUntil: "networkidle" });
  await page.locator('[data-testid="muya-markdown-editor"]').waitFor({ timeout: 30000 });
  await page.locator(".mu-atx-heading", { hasText: "XML / Markdown 编辑器" }).waitFor();

  const paragraph = page.locator(".mu-paragraph-content").first();
  await paragraph.click();
  await page.waitForTimeout(300);
  await page.keyboard.press("End");
  await page.keyboard.insertText(" 源码切换保留");
  await page.waitForFunction(() => {
    const editor = document.querySelector('[data-testid="muya-markdown-editor"]');
    return editor?.textContent?.includes("源码切换保留") === true;
  });
  await page.getByRole("button", { name: "源码模式" }).click();
  await page.locator('[data-testid="markdown-source-editor"]').waitFor();
  let source = await page.locator('[data-testid="markdown-source-editor"] .cm-content').innerText();
  assert.match(source, /源码切换保留/);

  const cmContent = page.locator('[data-testid="markdown-source-editor"] .cm-content');
  await cmContent.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("# Source Mode\n\nContent from source editor.");
  await page.locator(".tab-dirty-dot").waitFor();

  await page.getByRole("button", { name: "所见即所得" }).click();
  await page.locator('[data-testid="muya-markdown-editor"]').waitFor();
  await page.locator(".mu-atx-heading", { hasText: "Source Mode" }).waitFor();
  assert.match(await page.locator('[data-testid="muya-markdown-editor"]').innerText(), /Content from source editor/);

  await page.getByRole("button", { name: "源码模式" }).click();
  await page.locator('[data-testid="markdown-source-editor"]').waitFor();
  source = await page.locator('[data-testid="markdown-source-editor"] .cm-content').innerText();
  assert.match(source, /# Source Mode/);
  assert.match(source, /Content from source editor/);

  await page.getByRole("button", { name: "保存更改" }).click();
  await page.getByText("Markdown 文档已保存", { exact: true }).waitFor({ timeout: 10000 });
  await page.locator(".tab-dirty-dot").waitFor({ state: "detached" });

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join("; ")}`);
  console.log(JSON.stringify({
    ok: true,
    sourceModeRoundTrip: true,
    savedFromSourceMode: true,
  }, null, 2));
} finally {
  await browser.close();
}
