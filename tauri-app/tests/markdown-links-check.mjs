import assert from "node:assert/strict";
import { connectTauriPage, openFixtureSession } from "./e2e-utils.mjs";

const markdownPath = process.env.MD_E2E_FILE;
assert(markdownPath, "MD_E2E_FILE is required");

const { browser, page } = await connectTauriPage();

try {
  await openFixtureSession(page, [markdownPath], markdownPath);
  await page.locator('[data-testid="muya-markdown-editor"]').waitFor({ timeout: 20000 });

  const link = page.locator(".mu-inline-rule.mu-link", { hasText: "打开第二个文档" });
  await link.hover();
  await link.click();
  await page.locator(".mu-link-tools li.item.jump").waitFor();
  await page.evaluate(() => {
    const jump = document.querySelector(".mu-link-tools li.item.jump");
    if (jump instanceof HTMLElement) jump.click();
  });

  await page.locator('.file-tab .tab-file-name', { hasText: "second.md" }).waitFor({
    timeout: 10000,
  });
  await page.waitForTimeout(400);
  assert.match(await page.locator('[data-testid="muya-markdown-editor"]').innerText(), /Second document/);

  console.log(JSON.stringify({ ok: true, opened: "second.md" }, null, 2));
} finally {
  await browser.close();
}
