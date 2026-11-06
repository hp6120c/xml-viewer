import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const chromeCandidates = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];
const executablePath = chromeCandidates.find(fs.existsSync);
assert(executablePath, "Chrome or Edge executable was not found");

const outputDir = path.resolve(process.cwd(), "..", "..", "outputs");
fs.mkdirSync(outputDir, { recursive: true });
const port = 4174;
const server = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(port)],
  { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
);

async function waitForServer() {
  for (let index = 0; index < 80; index += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("CSV UI preview server did not start");
}

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
page.on("dialog", (dialog) => dialog.accept());

try {
  await waitForServer();
  await page.addInitScript(() => {
    localStorage.setItem("xml-viewer-session-v2", JSON.stringify({
      paths: ["C:/fixtures/sample.csv", "demo://README.md"],
      activePath: "C:/fixtures/sample.csv",
      zoom: 100,
    }));
  });
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
  await page.locator(".csv-editor").waitFor({ timeout: 20000 });
  await page.waitForTimeout(300);
  const tabBar = page.locator('[data-testid="tab-bar"]');
  assert.match(await tabBar.innerText(), /CSV/);
  assert.match(await tabBar.innerText(), /MD/);
  await tabBar.locator('[role="tab"]', { hasText: "README.md" }).click();
  await page.locator('[data-testid="muya-markdown-editor"]').waitFor({ timeout: 30000 });
  await page.locator('[data-testid="tab-bar"] [role="tab"]', { hasText: "sample.csv" }).click();
  await page.locator(".csv-editor").waitFor({ timeout: 20000 });

  const layout = await page.evaluate(() => {
    const readRect = (selector) => {
      const element = document.querySelector(selector);
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    };
    return {
      workspace: readRect(".workspace"),
      pane: readRect(".csv-content-pane"),
      editor: readRect(".csv-editor"),
      table: readRect(".csv-editor-table-wrap"),
      bodyScrollWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  assert(Math.abs(layout.pane.width - layout.workspace.width) <= 2, "CSV pane must fill workspace width");
  assert(Math.abs(layout.editor.width - layout.pane.width) <= 2, "CSV editor must fill pane width");
  assert(layout.table.height > 450, "CSV table area must fill available height");
  assert.equal(layout.bodyScrollWidth, layout.viewportWidth, "CSV page must not overflow horizontally");

  const rows = page.locator(".csv-editor-table tbody tr");
  assert.equal(await rows.count(), 5);
  assert.equal(await page.locator(".csv-editor-pagination").count(), 0);
  assert.match(await page.locator(".csv-editor-view-summary").innerText(), /不分页/);
  await page.getByLabel("全局筛选 CSV").fill("礼盒");
  assert.equal(await rows.count(), 1);
  await page.getByRole("button", { name: "清除筛选" }).click();

  await page.getByRole("button", { name: "筛选列 库存" }).click();
  const stockFilter = page.getByTestId("csv-filter-popover");
  await stockFilter.waitFor();
  await stockFilter.getByRole("button", { name: "清空", exact: true }).click();
  await stockFilter.getByRole("checkbox", { name: "120", exact: true }).check();
  await stockFilter.getByRole("button", { name: "应用筛选", exact: true }).click();
  assert.equal(await rows.count(), 1);
  await page.getByRole("button", { name: "清除筛选" }).click();

  const stockHeader = page.locator(".csv-editor-column-heading", { hasText: "库存" });
  await stockHeader.locator("button.csv-editor-sort-button").click();
  assert.match(await rows.first().innerText(), /S005/);
  await stockHeader.locator("button.csv-editor-sort-button").click();
  assert.match(await rows.first().innerText(), /S004/);
  await page.getByRole("button", { name: "清除排序" }).click();
  assert.match(await rows.first().innerText(), /S001/);

  await page.locator(".toolbar").getByRole("button", { name: "编辑模式" }).click();
  await rows.last().locator(".csv-editor-row-number").click();
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll(".csv-editor-button.danger")]
      .find((element) => element.textContent?.includes("删除行"));
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  await page.getByLabel("全局筛选 CSV").fill("S001");
  assert.equal(await rows.count(), 1);
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll(".csv-editor-button.danger")]
      .find((element) => element.textContent?.includes("删除行"));
    return button instanceof HTMLButtonElement && button.disabled;
  });
  await page.getByRole("button", { name: "清除筛选" }).click();
  const firstRow = rows.filter({ hasText: "S001" });
  await firstRow.locator("td").nth(1).dblclick();
  const cellEditor = page.locator(".csv-editor-cell-input");
  await cellEditor.fill("S001-已编辑");
  assert.equal(await page.locator(".tab-dirty-dot").count(), 1);
  assert.equal(await page.locator(".toolbar").getByRole("button", { name: "保存表格" }).isEnabled(), true);
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".csv-editor-cell-input").count(), 0, "Ctrl+S must flush the active cell");
  assert.match(await rows.filter({ hasText: "S001" }).innerText(), /S001-已编辑/);
  await page.getByRole("button", { name: "放弃修改" }).click();
  await page.waitForTimeout(250);
  assert.match(await rows.filter({ hasText: "S001" }).innerText(), /精品卷烟 A/);
  assert.equal(await page.locator(".tab-dirty-dot").count(), 0);
  await page.locator(".toolbar").getByRole("button", { name: "编辑模式" }).click();

  await page.getByRole("button", { name: "新增行" }).click();
  assert.equal(await rows.count(), 6);
  await rows.last().locator(".csv-editor-row-number").click();
  await page.getByRole("button", { name: "删除行" }).click();
  assert.equal(await rows.count(), 5);
  await page.getByRole("button", { name: "新增列" }).click();
  assert.equal(await page.locator(".csv-editor-column-heading").count(), 7);
  await page.getByRole("button", { name: "删除列" }).click();
  assert.equal(await page.locator(".csv-editor-column-heading").count(), 6);

  const encoding = page.getByLabel("CSV 文件编码");
  assert.equal(await encoding.isDisabled(), false);
  const encodings = await encoding.locator("option").evaluateAll((options) => options.map((option) => option.value));
  for (const value of ["UTF-8", "UTF-8 BOM", "UTF-16LE", "UTF-16BE", "GB18030", "GBK", "BIG5"]) {
    assert(encodings.includes(value), `Missing encoding option ${value}`);
  }
  await encoding.selectOption("GBK");
  assert.match(await page.locator(".toast").innerText(), /GBK/);
  await page.locator(".toolbar").getByRole("button", { name: "阅读模式" }).click();
  assert.equal(await page.locator(".csv-editor-readonly").count(), 1);
  assert.equal(await encoding.isDisabled(), false, "Encoding must remain selectable in read mode");
  await page.getByRole("button", { name: "按编码重读" }).click();
  await page.waitForTimeout(500);

  assert.deepEqual(pageErrors, []);
  await page.screenshot({ path: path.join(outputDir, "csv-editor-1440x900.png"), fullPage: true });

  for (const viewport of [{ width: 1024, height: 768 }, { width: 800, height: 700 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(200);
    const metrics = await page.evaluate(() => ({
      editorWidth: document.querySelector(".csv-editor").getBoundingClientRect().width,
      tableHeight: document.querySelector(".csv-editor-table-wrap").getBoundingClientRect().height,
      bodyScrollWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    assert(Math.abs(metrics.editorWidth - metrics.viewportWidth) <= 2);
    assert(metrics.tableHeight > 150);
    assert.equal(metrics.bodyScrollWidth, metrics.viewportWidth);
  }

  await page.getByRole("button", { name: "刷新" }).click();
  await page.waitForTimeout(400);
  console.log(JSON.stringify({ ok: true, layout, pageErrors, viewports: [1440, 1024, 800] }, null, 2));
} finally {
  await browser.close();
  server.kill();
  await new Promise((resolve) => {
    if (server.exitCode !== null) resolve();
    else server.once("exit", resolve);
  });
}
