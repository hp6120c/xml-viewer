import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const filePath = process.env.XML_VIEWER_E2E_FILE
  ? path.resolve(process.env.XML_VIEWER_E2E_FILE)
  : path.resolve(process.cwd(), "..", "..", "test-data", "real_lom.XML");
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const originalBytes = fs.readFileSync(filePath);
const originalHash = crypto.createHash("sha256").update(originalBytes).digest("hex");
const restoreOriginal = () => fs.writeFileSync(filePath, originalBytes);
process.on("exit", restoreOriginal);
process.on("uncaughtException", (error) => {
  restoreOriginal();
  console.error(error);
  process.exit(1);
});
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((item) => item.url().includes("tauri.localhost"));
if (!page) throw new Error("Tauri WebView page was not found over CDP");
await page.reload({ waitUntil: "networkidle" });

await page.locator('[data-testid="overview-page"]').waitFor();
if (!(await page.getByRole("button", { name: "GitHub" }).isVisible())) throw new Error("GitHub button missing");
if (!(await page.getByRole("button", { name: "检查更新" }).isVisible())) throw new Error("Update button missing");

const sidebar = page.locator('[data-testid="sidebar"]');
await page.getByLabel("搜索表名、字段名或备注").fill("VEND_NAME");
await sidebar.getByRole("button", { name: /LOM_VEND 供应商表/ }).waitFor();
const searchCount = await sidebar.locator(".tree-table").count();
if (searchCount < 1 || searchCount >= 100) throw new Error(`Unexpected field search count: ${searchCount}`);
await page.getByLabel("搜索表名、字段名或备注").fill("");

await sidebar.getByRole("button", { name: /LOM_VEND 供应商表/ }).click();
await page.locator('[data-testid="table-detail"]').waitFor();
await page.getByRole("button", { name: "编辑此表" }).click();
await page.locator('[data-testid="edit-page"]').waitFor();
await page.getByText("内容已与磁盘同步").waitFor();

const editor = page.locator(".cm-content");
await editor.click();
await page.keyboard.press("Control+A");
await page.keyboard.insertText('<table id="LOM_VEND"><broken>');
await page.getByRole("button", { name: "校验并阅读" }).click();
await page.getByText(/编辑内容不是有效 XML/).waitFor();
if (sha256(filePath) !== originalHash) throw new Error("Invalid XML changed the file on disk");

await editor.click();
await page.keyboard.press("Control+A");
await page.keyboard.insertText('<table id="LOM_VEND" name="供应商表自动化测试"><column id="VEND_ID" name="供应商编号" type="VARCHAR" size="64" required="true" primaryKey="true" /></table>');
await page.getByRole("button", { name: "校验并阅读" }).click();
await page.locator('[data-testid="table-detail"]').getByText("供应商表自动化测试", { exact: true }).waitFor();
const changed = fs.readFileSync(filePath, "utf8");
if (!changed.includes('name="供应商表自动化测试"')) throw new Error("Valid edit was not written to disk");
if (!changed.includes('<table id="LOM_VEND"')) throw new Error("Table identity was not preserved");

restoreOriginal();
console.log(JSON.stringify({
  status: "ok",
  searchCount,
  invalidXmlPreservedHash: true,
  validEditWritten: true,
  restoredHash: sha256(filePath) === originalHash,
}, null, 2));
await browser.close();



