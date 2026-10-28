import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const chromeCandidates = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];
const executablePath = chromeCandidates.find(fs.existsSync);
if (!executablePath) throw new Error("Chrome or Edge executable was not found");

const outputDir = path.resolve(process.cwd(), "..", "..", "..", "outputs");
fs.mkdirSync(outputDir, { recursive: true });

const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4173"], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
});

async function waitForServer() {
  for (let index = 0; index < 60; index += 1) {
    try {
      const response = await fetch("http://127.0.0.1:4173");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Vite preview server did not start");
}

const results = [];
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true, executablePath });
  const sizes = [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 1600, height: 1000 },
    { width: 1100, height: 640 },
    { width: 960, height: 640 },
  ];

  for (const viewport of sizes) {
    const page = await browser.newPage({ viewport });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    await page.goto("http://127.0.0.1:4173", { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('[data-testid="overview-page"]').waitFor();
    if (!(await page.getByRole("button", { name: "GitHub" }).isVisible())) {
      throw new Error("GitHub link button is missing");
    }
    if (!(await page.getByRole("button", { name: "检查更新" }).isVisible())) {
      throw new Error("Update button is missing");
    }

    await page.getByLabel("搜索表名、字段名或备注").fill("直接主键");
    const sidebar = page.locator('[data-testid="sidebar"]');
    await sidebar.getByRole("button", { name: /DIRECT_TABLE/ }).waitFor();
    const searchResult = {
      directVisible: await sidebar.getByRole("button", { name: /DIRECT_TABLE/ }).isVisible(),
      orderCount: await sidebar.getByRole("button", { name: "WMS_ORDER" }).count(),
    };
    if (!searchResult.directVisible || searchResult.orderCount !== 0) {
      throw new Error(`Field search failed at ${viewport.width}`);
    }
    await page.getByLabel("搜索表名、字段名或备注").fill("订单号");
    await sidebar.getByRole("button", { name: "WMS_ORDER" }).waitFor();
    if (!(await sidebar.getByRole("button", { name: "WMS_ORDER" }).isVisible())) {
      throw new Error(`Collapsed submodule was not expanded by search at ${viewport.width}`);
    }
    await page.getByLabel("搜索表名、字段名或备注").fill("");
    await page.getByRole("button", { name: "WMS_ORDER" }).first().waitFor();

    const overviewMetrics = await page.evaluate(() => {
      const content = document.querySelector('[data-testid="content-pane"]');
      const pageElement = document.querySelector('[data-testid="overview-page"]');
      const tableScroll = document.querySelector('[data-testid="all-table-catalog"]')?.parentElement;
      const table = document.querySelector('[data-testid="all-table-catalog"]');
      if (!content || !pageElement || !tableScroll || !table) return null;
      const contentRect = content.getBoundingClientRect();
      const pageRect = pageElement.getBoundingClientRect();
      const scrollRect = tableScroll.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();
      return {
        viewport: { width: innerWidth, height: innerHeight },
        contentWidth: contentRect.width,
        pageWidth: pageRect.width,
        tableScrollWidth: scrollRect.width,
        tableWidth: tableRect.width,
        rightGap: Math.round((scrollRect.right - tableRect.right) * 100) / 100,
        pageHorizontalOverflow: pageElement.scrollWidth - pageElement.clientWidth,
        scrollHorizontalOverflow: tableScroll.scrollWidth - tableScroll.clientWidth,
      };
    });

    if (viewport.width === 1440) {
      await page.screenshot({ path: path.join(outputDir, "tauri-overview-1440x900.png") });
    }

    await page.getByRole("button", { name: "WMS_ORDER" }).first().click();
    await page.locator('[data-testid="table-detail"]').waitFor();
    const detailMetrics = await page.evaluate(() => {
      const detail = document.querySelector('[data-testid="table-detail"]');
      const tableScroll = document.querySelector('[data-testid="field-table"]')?.parentElement;
      const table = document.querySelector('[data-testid="field-table"]');
      if (!detail || !tableScroll || !table) return null;
      const detailRect = detail.getBoundingClientRect();
      const scrollRect = tableScroll.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();
      return {
        detailWidth: detailRect.width,
        tableScrollWidth: scrollRect.width,
        tableWidth: tableRect.width,
        rightGap: Math.round((scrollRect.right - tableRect.right) * 100) / 100,
        pageHorizontalOverflow: detail.scrollWidth - detail.clientWidth,
        scrollHorizontalOverflow: tableScroll.scrollWidth - tableScroll.clientWidth,
      };
    });
    const badges = {
      primaryKey: await page.getByText("PK", { exact: true }).count(),
      required: await page.getByText("必填", { exact: true }).count(),
    };
    if (badges.primaryKey < 1 || badges.required < 1) {
      throw new Error(`Boolean badges were not rendered at ${viewport.width}`);
    }

    if (viewport.width === 1440) {
      await page.screenshot({ path: path.join(outputDir, "tauri-detail-1440x900.png") });
      await page.getByRole("button", { name: "编辑此表" }).click();
      await page.locator('[data-testid="xml-editor"]').waitFor();
      await page.getByText("内容已与磁盘同步").waitFor();
      await page.screenshot({ path: path.join(outputDir, "tauri-editor-1440x900.png") });

      for (let index = 0; index < 4; index += 1) {
        await page.getByRole("button", { name: "放大界面" }).click();
      }
      await page.locator(".file-tab").first().click({ button: "right" });
      const menuBox = await page.locator(".context-menu").boundingBox();
      if (!menuBox || menuBox.x < 0 || menuBox.y < 0 || menuBox.x + menuBox.width > viewport.width + 1 || menuBox.y + menuBox.height > viewport.height + 1) {
        throw new Error(`Context menu is outside viewport at ${JSON.stringify(menuBox)}`);
      }
      await page.locator(".context-backdrop").click({ position: { x: 3, y: 3 } });

      await page.evaluate(() => localStorage.setItem("xml-viewer-session-v2", JSON.stringify({
        paths: ["demo://session.xml"],
        activePath: "demo://session.xml",
        zoom: 120,
      })));
      await page.reload({ waitUntil: "networkidle" });
      await page.locator('[data-testid="overview-page"]').waitFor();
      if (!(await page.locator(".zoom-control").getByText("120%").isVisible())) {
        throw new Error("Session zoom was not restored");
      }
      if ((await page.locator("[role=tab]").count()) < 1) {
        throw new Error("Session file tabs were not restored");
      }
    }

    results.push({ viewport, overviewMetrics, detailMetrics, searchResult, badges, pageErrors });
    await page.close();
  }

  for (const result of results) {
    if (!result.overviewMetrics || !result.detailMetrics) throw new Error(`Missing layout metrics for ${result.viewport.width}`);
    if (result.overviewMetrics.rightGap > 3 && result.overviewMetrics.scrollHorizontalOverflow === 0) {
      throw new Error(`Overview table does not fill its container at ${result.viewport.width}`);
    }
    if (result.detailMetrics.rightGap > 3 && result.detailMetrics.scrollHorizontalOverflow === 0) {
      throw new Error(`Detail table does not fill its container at ${result.viewport.width}`);
    }
    if (result.overviewMetrics.pageHorizontalOverflow > 1) throw new Error(`Overview page overflows at ${result.viewport.width}`);
    if (result.detailMetrics.pageHorizontalOverflow > 1) throw new Error(`Detail page overflows at ${result.viewport.width}`);
    if (result.pageErrors.length) throw new Error(`Page errors at ${result.viewport.width}: ${result.pageErrors.join("; ")}`);
  }

  console.log(JSON.stringify({ status: "ok", executablePath, results, outputDir }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server.pid) {
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
      else server.kill();
    } catch {}
  }
}





