import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { connectTauriPage, openFixtureSession } from "./e2e-utils.mjs";

const DATA_ROW_COUNT = 30_000;
const CATEGORIES = ["电子产品", "办公用品", "家用电器", "图书"];
const SELECTED_CATEGORY = "电子产品";
const SELECTED_CATEGORY_ROW_COUNT = DATA_ROW_COUNT / CATEGORIES.length;
const CSV_INTERACTIVE_TIMEOUT_MS = 8_000;

function createLargeCsv(rowCount) {
  const lines = ["编号,名称,分类,库存,价格"];

  for (let index = 1; index <= rowCount; index += 1) {
    const category = CATEGORIES[(index - 1) % CATEGORIES.length];
    const stock = (index * 7) % 500;
    const price = (1 + ((index * 37) % 10_000) / 100).toFixed(2);
    lines.push(
      `${index},商品${String(index).padStart(5, "0")},${category},${stock},${price}`,
    );
  }

  return `${lines.join("\r\n")}\r\n`;
}

function compactText(value) {
  return value.replace(/[,，\s]/g, "");
}

async function waitForRowStats(page, filteredRows, totalRows, timeout = 10_000) {
  await page.waitForFunction(
    ({ expectedFiltered, expectedTotal }) => {
      const counter = document.querySelector(".csv-editor-counter");
      if (!(counter instanceof HTMLElement)) return false;
      const text = (counter.textContent ?? "").replace(/[,，\s]/g, "");
      return text.includes(String(expectedFiltered)) && text.includes(String(expectedTotal));
    },
    { expectedFiltered: filteredRows, expectedTotal: totalRows },
    { timeout },
  );

  return (await page.locator(".csv-editor-counter").innerText()).trim();
}

async function waitForInteractiveTable(page, deadline) {
  const scrollContainer = page.locator('[data-testid="csv-table-scroll"]');
  const remaining = Math.max(1, Math.floor(deadline - performance.now()));
  await scrollContainer.waitFor({ state: "visible", timeout: remaining });

  const tableTimeout = Math.max(1, Math.floor(deadline - performance.now()));
  await page.waitForFunction(
    () => {
      const scroll = document.querySelector('[data-testid="csv-table-scroll"]');
      if (!(scroll instanceof HTMLElement) || scroll.clientHeight <= 0) return false;
      return Boolean(scroll.querySelector(".csv-editor-table tbody tr"));
    },
    undefined,
    { timeout: tableTimeout },
  );
}

const tempDir = await mkdtemp(path.join(tmpdir(), "xml-viewer-csv-large-e2e-"));
const csvPath = path.join(tempDir, "large-csv-30000.csv");
await writeFile(csvPath, createLargeCsv(DATA_ROW_COUNT), "utf8");

const { browser, page } = await connectTauriPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));

try {
  const openStartedAt = performance.now();
  await openFixtureSession(page, [csvPath], csvPath);
  await waitForInteractiveTable(page, openStartedAt + CSV_INTERACTIVE_TIMEOUT_MS);

  const interactiveElapsedMs = performance.now() - openStartedAt;
  assert.ok(
    interactiveElapsedMs <= CSV_INTERACTIVE_TIMEOUT_MS,
    `CSV table took ${interactiveElapsedMs.toFixed(0)} ms to become interactive; expected <= ${CSV_INTERACTIVE_TIMEOUT_MS} ms`,
  );

  assert.equal(
    await page.locator(".csv-editor-pagination").count(),
    0,
    "Large CSV view must not render pagination controls",
  );
  const pageText = await page.locator("body").innerText();
  assert.doesNotMatch(pageText, /下一页|每页/, "Large CSV view must not show pagination labels");

  const initialStats = await waitForRowStats(page, DATA_ROW_COUNT, DATA_ROW_COUNT);
  assert(
    compactText(initialStats).includes(String(DATA_ROW_COUNT)),
    `Row-count statistics should show ${DATA_ROW_COUNT}; received: ${initialStats}`,
  );
  assert(
    await page.locator(".csv-editor-table tbody tr").count() < 200,
    "Virtualized CSV table should only render rows near the viewport",
  );

  const categoryFilter = page.locator('[aria-label="筛选列 分类"]');
  await categoryFilter.waitFor({ state: "visible" });
  await categoryFilter.click();

  const filterPopover = page.getByTestId("csv-filter-popover");
  await filterPopover.waitFor({ state: "visible", timeout: 5_000 });
  await filterPopover.getByRole("button", { name: "清空", exact: true }).click();
  const categoryCheckbox = filterPopover.getByRole("checkbox", { name: /电子产品/ });
  await categoryCheckbox.check();
  assert.equal(await categoryCheckbox.isChecked(), true, "Category checkbox should remain checked");
  await filterPopover.getByRole("button", { name: "应用筛选", exact: true }).click();

  const filteredStats = await waitForRowStats(
    page,
    SELECTED_CATEGORY_ROW_COUNT,
    DATA_ROW_COUNT,
  );
  const compactFilteredStats = compactText(filteredStats);
  assert(
    compactFilteredStats.includes(String(SELECTED_CATEGORY_ROW_COUNT))
      && compactFilteredStats.includes(String(DATA_ROW_COUNT)),
    `Filtered statistics should include ${SELECTED_CATEGORY_ROW_COUNT} / ${DATA_ROW_COUNT}; received: ${filteredStats}`,
  );

  await page.waitForFunction(
    (selectedCategory) => {
      const rows = Array.from(document.querySelectorAll(".csv-editor-table tbody tr"))
        .filter((row) => row.querySelectorAll("td").length >= 5);
      if (rows.length === 0) return false;
      return rows.every((row) => row.querySelectorAll("td")[2]?.textContent?.trim() === selectedCategory);
    },
    SELECTED_CATEGORY,
    { timeout: 10_000 },
  );

  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  const clearedStats = await waitForRowStats(page, DATA_ROW_COUNT, DATA_ROW_COUNT);
  assert(
    compactText(clearedStats).includes(String(DATA_ROW_COUNT)),
    `Clearing filters should restore all ${DATA_ROW_COUNT} rows; received: ${clearedStats}`,
  );

  const scrollContainer = page.locator('[data-testid="csv-table-scroll"]');
  await scrollContainer.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await page.waitForFunction(
    () => {
      const scroll = document.querySelector('[data-testid="csv-table-scroll"]');
      if (!(scroll instanceof HTMLElement)) return false;
      return scroll.scrollHeight <= scroll.clientHeight
        || scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 4;
    },
    undefined,
    { timeout: 10_000 },
  );

  const lastRowHandle = await page.waitForFunction(
    () => {
      const rows = Array.from(document.querySelectorAll(".csv-editor-table tbody tr"))
        .filter((row) => row.querySelectorAll("td").length >= 5);
      const lastRow = rows[rows.length - 1];
      if (!lastRow) return false;
      const text = lastRow.textContent ?? "";
      if (!text.includes("商品30000") || !text.includes("图书")) return false;
      return text;
    },
    undefined,
    { timeout: 10_000 },
  );
  const lastRowText = await lastRowHandle.jsonValue();
  assert.match(lastRowText, /商品30000/, "The final CSV row should be reachable after scrolling");
  assert.match(lastRowText, /图书/, "The final CSV row should retain its category value");

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join("; ")}`);

  console.log(JSON.stringify({
    ok: true,
    csvPath,
    dataRows: DATA_ROW_COUNT,
    interactiveElapsedMs: Number(interactiveElapsedMs.toFixed(1)),
    interactiveTimeoutMs: CSV_INTERACTIVE_TIMEOUT_MS,
    initialStats,
    filteredStats,
    clearedStats,
    lastRowText,
  }, null, 2));
} finally {
  await browser.close();
  await rm(tempDir, { recursive: true, force: true });
}

