import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { connectTauriPage, fixturePath, openFixtureSession } from "./e2e-utils.mjs";

const testFile = process.env.MD_E2E_FILE;
assert(testFile, "MD_E2E_FILE is required");
const testFileName = testFile.split(/[\\/]/).pop();
assert(testFileName, "MD_E2E_FILE must include a file name");

const { browser, page } = await connectTauriPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));

try {
  await openFixtureSession(page, [testFile, fixturePath("generic.xml")], testFile);
  await page.locator('[data-testid="muya-markdown-editor"]').waitFor({ timeout: 20000 });
  const editorText = await page.locator('[data-testid="muya-markdown-editor"]').innerText();
  assert.match(editorText, /MD Reader/);
  assert.match(editorText, /主要特性/);

  const title = await page.title();
  assert.match(title, /数据库设计查看器|XML \/ Markdown/);

  const tabText = await page.locator('[data-testid="tab-bar"]').innerText();
  assert.match(tabText, /MD/);
  assert.ok(tabText.includes(testFileName));

  await page.evaluate(() => {
    const target = Array.from(document.querySelectorAll(".mu-plain-text"))
      .find((element) => element.textContent?.includes("MarkText WYSIWYG"));
    const textNode = target?.firstChild;
    if (!(textNode instanceof Text)) throw new Error("Font selection text node was not found");
    const start = textNode.textContent?.indexOf("MarkText WYSIWYG") ?? -1;
    if (start < 0) throw new Error("Font selection text was not found");
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + "MarkText WYSIWYG".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.locator('select[aria-label="文字字号"]').selectOption("24px");
  await page.getByRole("button", { name: "应用字体" }).click();
  await page.getByText("已应用字体：24px / system", { exact: true }).waitFor();

  const paragraph = page.locator(".mu-paragraph-content").first();
  await paragraph.click();
  await page.waitForTimeout(150);
  await page.keyboard.press("End");
  await page.keyboard.type(" Markdown E2E save test.");
  await page.locator(".tab-dirty-dot").waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "保存更改" }).click();
  await page.getByText("Markdown 文档已保存", { exact: true }).waitFor({ timeout: 15000 });
  await page.locator(".tab-dirty-dot").waitFor({ state: "detached" });

  const saved = await readFile(testFile, "utf8");
  assert.match(saved, /Markdown E2E save test/);
  assert.match(saved, /<span style="font-size: 24px;/);
  assert.match(saved, /!\[本地图片\]\(images\/test\.png\)/);
  assert.match(saved, /!\[本地图片二\]\(images\/test2\.png\)/);
  assert.match(saved, /!\[本地图片三\]\(images\/test3\.png\)/);
  assert.doesNotMatch(saved, /data:image\//);

  await page.locator(".toolbar .tool-button", { hasText: "刷新" }).click();
  await page.getByText("文件已刷新", { exact: true }).waitFor({ timeout: 10000 });
  await page.locator('[data-testid="muya-markdown-editor"]').waitFor();
  assert.match(await page.locator('[data-testid="muya-markdown-editor"]').innerText(), /Markdown E2E save test/);
  assert.equal(await page.locator(".muya-markdown-host img").count(), 3);
  assert.equal(await page.locator(".mu-inline-rule.mu-raw-html").first().evaluate(
    (element) => getComputedStyle(element).fontSize,
  ), "24px");

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
