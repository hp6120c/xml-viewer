import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { connectTauriPage, fixturePath, openFixtureSession } from "./e2e-utils.mjs";

const outputDir = path.resolve("..", "..", "outputs");
await mkdir(outputDir, { recursive: true });
const { browser, page } = await connectTauriPage();
const markdownPath = process.env.MD_E2E_FILE ?? fixturePath("markdown-test.md");

try {
  await openFixtureSession(page, [markdownPath], markdownPath);
  await page.locator('[data-testid="muya-markdown-editor"]').waitFor({ timeout: 20000 });
  await page.locator(".toolbar .tool-button", { hasText: "刷新" }).click();
  await page.waitForTimeout(1200);

  const images = page.locator('[data-testid="muya-markdown-editor"] .muya-markdown-host img');
  const imageCount = await images.count();
  assert(imageCount >= 3, `expected at least 3 Markdown images, found ${imageCount}`);
  const sources = await images.evaluateAll((items) => items.map((item) => item.getAttribute("src") ?? ""));
  assert(sources.some((source) => /^data:image\/png;/.test(source)));
  const codeText = await page.locator(".mu-codeblock-content").first().innerText();
  assert.match(codeText, /!\[code\]\(images\/test\.png\)/);
  assert.doesNotMatch(codeText, /data:image\//);
  const screenshot = path.join(outputDir, "markdown-real-document-1440x900.png");
  await page.screenshot({ path: screenshot, fullPage: true });

  console.log(JSON.stringify({
    ok: true,
    imageCount,
    screenshot,
    sources: sources.map((source) => source.slice(0, 22)),
  }, null, 2));
} finally {
  await browser.close();
}
