import assert from "node:assert/strict";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { connectTauriPage, openFixtureSession } from "./e2e-utils.mjs";

const testFile = process.env.MD_E2E_FILE;
const sourceFile = process.env.MD_E2E_SOURCE;
assert(testFile, "MD_E2E_FILE is required");
assert(sourceFile, "MD_E2E_SOURCE is required");

const { browser, page } = await connectTauriPage();

try {
  await openFixtureSession(page, [testFile], testFile);
  await page.locator('[data-testid="muya-markdown-editor"]').waitFor({ timeout: 20000 });
  await page.locator(".toolbar .tool-button", { hasText: "刷新" }).click();
  await page.getByText("文件已刷新", { exact: true }).waitFor();

  await page.locator(".mu-paragraph-content").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Local edit");
  await page.locator(".tab-dirty-dot").waitFor();

  await writeFile(testFile, "# External edit\n", "utf8");
  await page.getByRole("button", { name: "保存更改" }).click();
  await page.getByText(/Markdown 文件已被其他程序修改/).waitFor({ timeout: 15000 });

  assert.equal(await readFile(testFile, "utf8"), "# External edit\n");
  console.log(JSON.stringify({ ok: true, conflictProtected: true }));
} finally {
  await copyFile(sourceFile, testFile);
  await browser.close();
}
