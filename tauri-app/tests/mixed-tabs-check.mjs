import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { connectTauriPage, fixturePath, openFixtureSession } from "./e2e-utils.mjs";

const outputDir = path.resolve("..", "..", "outputs");
await mkdir(outputDir, { recursive: true });

const { browser, page } = await connectTauriPage();
const markdownPath = fixturePath("markdown-test.md");
const xmlPath = fixturePath("generic.xml");

try {
  await openFixtureSession(page, [markdownPath, xmlPath], markdownPath);
  const tabBar = page.locator('[data-testid="tab-bar"]');
  await tabBar.waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);

  const tabs = await tabBar.innerText();
  assert.match(tabs, /XML/);
  assert.match(tabs, /MD/);
  assert.match(tabs, /markdown-test\.md/);
  assert.match(tabs, /generic\.xml/);

  await tabBar.locator('[role="tab"]', { hasText: "generic.xml" }).click();
  await page.locator('[data-testid="generic-xml-view"]').waitFor();
  await page.getByText("通用 XML 预览", { exact: true }).waitFor();

  const screenshot = path.join(outputDir, "mixed-xml-markdown-tabs-1440x900.png");
  await page.screenshot({ path: screenshot, fullPage: true });

  await tabBar.locator('[role="tab"]', { hasText: "markdown-test.md" }).click();
  await page.locator('[data-testid="muya-markdown-editor"]').waitFor();

  console.log(JSON.stringify({ ok: true, tabs, screenshot }, null, 2));
} finally {
  await browser.close();
}
