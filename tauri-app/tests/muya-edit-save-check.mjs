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

  const paragraph = page.locator(".mu-paragraph-content", {
    hasText: "支持 XML 数据库设计和 Markdown 文档阅读",
  }).first();
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.type("（直接编辑验证）");
  await page.locator(".tab-dirty-dot").waitFor({ timeout: 5000 });
  await page.waitForFunction(() => {
    const target = document.querySelector(".mu-paragraph-content");
    return target?.textContent?.includes("（直接编辑验证）") === true;
  });
  assert.match(await paragraph.innerText(), /直接编辑验证/);

  for (let index = 0; index < 10; index += 1) await page.keyboard.press("Control+Z");
  await page.waitForTimeout(250);
  assert.doesNotMatch(await paragraph.innerText(), /直接编辑验证/);
  for (let index = 0; index < 10; index += 1) await page.keyboard.press("Control+Y");
  await page.waitForTimeout(250);
  assert.match(await paragraph.innerText(), /直接编辑验证/);

  const saveButton = page.getByRole("button", { name: "保存更改" });
  assert.equal(await saveButton.isEnabled(), true);
  await saveButton.click();
  await page.getByText("Markdown 文档已保存", { exact: true }).waitFor({ timeout: 10000 });
  await page.locator(".tab-dirty-dot").waitFor({ state: "detached", timeout: 5000 });
  assert.match(await paragraph.innerText(), /直接编辑验证/);
  assert.equal(await saveButton.isDisabled(), true);

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join("; ")}`);
  console.log(JSON.stringify({
    ok: true,
    editedText: await paragraph.innerText(),
    dirtyAfterSave: await page.locator(".tab-dirty-dot").count(),
  }, null, 2));
} finally {
  await browser.close();
}
