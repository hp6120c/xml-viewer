import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { connectTauriPage, openFixtureSession } from "./e2e-utils.mjs";

const csvSource = [
  "编号,名称,分类,数量,价格",
  "1,红色笔记本,办公,10,12.50",
  "2,蓝色钢笔,办公,8,23.00",
  "3,绿色文件夹,用品,15,6.80",
  "4,红色订书机,办公,3,35.00",
  "5,蓝色胶带,用品,20,4.50",
  "6,绿色便签,用品,30,2.20",
  "",
].join("\r\n");

const tempDir = await mkdtemp(path.join(tmpdir(), "xml-viewer-csv-e2e-"));
const csvPath = path.join(tempDir, "csv-e2e.csv");
await writeFile(csvPath, csvSource, "utf8");

const { browser, page } = await connectTauriPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));

const tableRows = page.locator(".csv-editor-table tbody tr");

async function waitForRowCount(expected) {
  await page.waitForFunction(
    (count) => document.querySelectorAll(".csv-editor-table tbody tr").length === count,
    expected,
    { timeout: 10000 },
  );
}

async function waitForFirstQuantity(expected) {
  await page.waitForFunction(
    (value) => {
      const firstRow = document.querySelector(".csv-editor-table tbody tr");
      const cells = firstRow?.querySelectorAll("td");
      return cells?.[3]?.textContent?.trim() === value;
    },
    expected,
    { timeout: 10000 },
  );
}

try {
  await openFixtureSession(page, [csvPath], csvPath);
  await page.locator(".csv-editor").waitFor({ timeout: 20000 });
  await page.locator(".csv-editor-table").waitFor();

  assert.equal(await tableRows.count(), 6);
  assert.equal(await page.locator(".csv-editor-errors").count(), 0);
  assert.match(await page.locator(".file-tab-wrap.active").innerText(), /CSV/);
  assert.match(await page.locator(".csv-editor-file").innerText(), /csv-e2e\.csv/);

  await page.waitForTimeout(200);
  const layout = await page.evaluate(() => {
    const pane = document.querySelector('[data-testid="content-pane"]');
    const editor = document.querySelector(".csv-editor");
    const tableWrap = document.querySelector(".csv-editor-table-wrap");
    if (!(pane instanceof HTMLElement) || !(editor instanceof HTMLElement) || !(tableWrap instanceof HTMLElement)) {
      return null;
    }
    const paneRect = pane.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    const tableRect = tableWrap.getBoundingClientRect();
    return {
      paneWidth: paneRect.width,
      paneHeight: paneRect.height,
      editorWidth: editorRect.width,
      editorHeight: editorRect.height,
      tableWidth: tableRect.width,
      tableHeight: tableRect.height,
      rootOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  assert(layout, "CSV layout metrics were not available");
  assert(Math.abs(layout.paneWidth - layout.editorWidth) <= 2, "CSV editor must fill pane width");
  assert(Math.abs(layout.paneHeight - layout.editorHeight) <= 2, "CSV editor must fill pane height");
  assert(layout.tableWidth >= layout.paneWidth - 2, "CSV table area must fill available width");
  assert(layout.tableHeight > 150, "CSV table area must occupy the available height");
  assert(layout.rootOverflow <= 0, "CSV editor must not create page-level horizontal overflow");

  assert.equal(await page.locator(".csv-editor.csv-editor-readonly").count(), 1);
  assert.equal(await page.locator(".csv-editor-pagination").count(), 0);
  await page.getByRole("button", { name: "编辑模式", exact: true }).click();
  await page.locator(".csv-editor:not(.csv-editor-readonly)").waitFor();
  await page.getByRole("button", { name: "阅读模式", exact: true }).click();
  await page.locator(".csv-editor.csv-editor-readonly").waitFor();
  await page.getByRole("button", { name: "编辑模式", exact: true }).click();
  await page.locator(".csv-editor:not(.csv-editor-readonly)").waitFor();

  const encodingSelect = page.locator('select[aria-label="CSV 文件编码"]');
  assert.equal(await encodingSelect.count(), 1);
  assert.equal(await encodingSelect.isDisabled(), false);
  const encodingValues = await encodingSelect.locator("option").evaluateAll(
    (options) => options.map((option) => option.value),
  );
  for (const encoding of ["UTF-8", "UTF-8 BOM", "UTF-16LE", "UTF-16BE", "GB18030", "GBK", "BIG5"]) {
    assert(encodingValues.includes(encoding), `Missing CSV encoding option: ${encoding}`);
  }

  const globalFilter = page.locator('input[aria-label="全局筛选 CSV"]');
  await globalFilter.fill("蓝色");
  await waitForRowCount(2);
  assert.equal(await page.locator(".csv-editor-table tbody tr", { hasText: "红色" }).count(), 0);

  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await waitForRowCount(6);

  await page.getByRole("button", { name: "筛选列 分类", exact: true }).click();
  const categoryFilter = page.getByTestId("csv-filter-popover");
  await categoryFilter.waitFor();
  await categoryFilter.getByRole("button", { name: "清空", exact: true }).click();
  await categoryFilter.getByRole("checkbox", { name: "用品", exact: true }).check();
  await categoryFilter.getByRole("button", { name: "应用筛选", exact: true }).click();
  await waitForRowCount(3);
  assert.equal(await page.locator(".csv-editor-table tbody tr", { hasText: "办公" }).count(), 0);

  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await waitForRowCount(6);

  const quantitySortButton = page
    .locator(".csv-editor-column-heading", { hasText: "数量" })
    .locator("button.csv-editor-sort-button");
  await quantitySortButton.click();
  await waitForFirstQuantity("3");
  await quantitySortButton.click();
  await waitForFirstQuantity("30");

  const editedRow = page.locator(".csv-editor-table tbody tr", { hasText: "红色笔记本" }).first();
  const nameCell = editedRow.locator("td").nth(1);
  await nameCell.dblclick();
  const cellEditor = page.locator("textarea.csv-editor-cell-input");
  await cellEditor.waitFor();
  await cellEditor.fill("红色笔记本-已编辑");
  await cellEditor.press("Enter");
  await page.locator(".csv-editor-table tbody tr", { hasText: "红色笔记本-已编辑" }).waitFor();
  await page.locator(".tab-dirty-dot").waitFor({ timeout: 5000 });

  assert.equal(await tableRows.count(), 6);
  await page.getByRole("button", { name: "新增行", exact: true }).click();
  await waitForRowCount(7);
  await tableRows.last().locator(".csv-editor-row-number").click();
  await page.getByRole("button", { name: "删除行", exact: true }).click();
  await waitForRowCount(6);

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join("; ")}`);
  console.log(JSON.stringify({
    ok: true,
    csvPath,
    layout,
    filters: { global: 2, column: 3 },
    sort: { ascendingFirst: 3, descendingFirst: 30 },
    editedCell: "红色笔记本-已编辑",
    rowCountAfterAddDelete: await tableRows.count(),
  }, null, 2));
} finally {
  await browser.close();
  await rm(tempDir, { recursive: true, force: true });
}