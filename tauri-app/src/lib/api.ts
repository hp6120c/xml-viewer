import type {
  AppInfo,
  ColumnInfo,
  MarkdownDocument,
  OpenedDocument,
  TableInfo,
  TableSource,
  XmlDocument,
} from "../types";

function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const api = await import("@tauri-apps/api/core");
  return api.invoke<T>(command, args);
}

function makeColumn(
  id: string,
  name: string,
  columnType: string,
  required = false,
  primaryKey = false,
  note = "",
): ColumnInfo {
  return {
    id,
    name,
    columnType,
    size: "",
    required,
    primaryKey,
    default: "",
    enumValue: "",
    note,
    format: "",
    inputSize: "",
    attrs: {},
  };
}

function makeTable(
  nodeIndex: number,
  id: string,
  name: string,
  moduleId: string,
  moduleName: string,
  submoduleId: string,
  submoduleName: string,
  columns: ColumnInfo[],
  remarks: string[] = [],
): TableInfo {
  return {
    nodeIndex,
    id,
    name,
    moduleId,
    moduleName,
    submoduleId,
    submoduleName,
    tableType: "table",
    view: "",
    sql: "",
    volume: "120",
    frequency: "每日",
    period: "",
    tsp: "DATA",
    package: "",
    columns,
    remarks,
    foreignKeys: [],
    indexes: [],
    attrs: {},
  };
}

export function demoDocument(): XmlDocument {
  const direct = makeTable(
    0,
    "DIRECT_TABLE",
    "直接挂在模块下的表",
    "MOD_DIRECT",
    "直接模块",
    "",
    "",
    [
      makeColumn("DIRECT_ID", "直接主键", "VARCHAR", true, true, "用于验证直接模块表"),
      makeColumn("DIRECT_NAME", "名称", "VARCHAR", false, false, "直接表没有子模块"),
    ],
    ["直接模块下的表也必须完整显示"],
  );
  const order = makeTable(
    1,
    "WMS_ORDER",
    "订单主表",
    "MOD_WMS",
    "仓储模块",
    "SUB_ORDER",
    "订单管理",
    [
      makeColumn("ORDER_ID", "订单号", "VARCHAR", true, true, "业务主键"),
      makeColumn("ORDER_NO", "订单编码", "VARCHAR", true, false, "唯一编码"),
      makeColumn("STATUS", "状态", "NUMBER", true, false, "0-新建，1-完成"),
      makeColumn("CREATED_AT", "创建时间", "TIMESTAMP", false, false, "创建时间"),
      makeColumn("REMARK", "备注", "VARCHAR", false, false, "长文本说明"),
    ],
    ["订单核心表", "用于验证备注不会显示成 Python 列表"],
  );
  const inventory = makeTable(
    2,
    "WMS_INVENTORY",
    "库存明细",
    "MOD_WMS",
    "仓储模块",
    "SUB_STOCK",
    "库存管理",
    [
      makeColumn("MATERIAL_ID", "物料编码", "VARCHAR", true, true),
      makeColumn("WAREHOUSE_ID", "仓库编码", "VARCHAR", true, true),
      makeColumn("QUANTITY", "库存数量", "DECIMAL", true, false, "允许小数"),
      makeColumn("LOCKED_QTY", "锁定数量", "DECIMAL", false, false),
      makeColumn("UPDATED_AT", "更新时间", "TIMESTAMP", false, false),
    ],
    ["库存实时数据"],
  );
  return {
    path: "demo://scl_schema_demo.xml",
    fileName: "scl_schema_demo.xml",
    fileSize: 8192,
    rootTag: "app-data",
    encoding: "UTF-8",
    kind: "scl",
    database: { id: "DEMO_DB", name: "演示数据库" },
    genericRoot: null,
    rawSource: null,
    modules: [
      {
        nodeIndex: 0,
        id: "MOD_DIRECT",
        name: "直接模块",
        subsystemId: "",
        subsystemName: "",
        submodules: [],
        tables: [direct],
      },
      {
        nodeIndex: 1,
        id: "MOD_WMS",
        name: "仓储模块",
        subsystemId: "SYS_WMS",
        subsystemName: "仓储子系统",
        tables: [],
        submodules: [
          { nodeIndex: 0, id: "SUB_ORDER", name: "订单管理", tables: [order] },
          { nodeIndex: 1, id: "SUB_STOCK", name: "库存管理", tables: [inventory] },
        ],
      },
    ],
  };
}

export function demoMarkdownDocument(): MarkdownDocument {
  const source = `# XML / Markdown 查看器

支持 XML 数据库设计和 Markdown 文档阅读、编辑的桌面工具。

## 快速开始

- 使用顶部“打开文件”打开单个 XML 或 Markdown 文件
- 使用“打开文件夹”浏览同一目录中的多种文档
- 标签页保留各自的查看位置

## 目录结构

\`\`\`text
xml-viewer/
├─ tauri-app/     # 桌面应用
├─ docs/          # 文档与设计记录
└─ outputs/       # 构建与验收产物
\`\`\`

## 主要功能

| 文件类型 | 阅读方式 | 编辑方式 |
| --- | --- | --- |
| XML | 数据库、表、字段结构 | 单表 XML 编辑 |
| Markdown | 大纲与渲染文档 | 源码与实时预览 |

## 常见问题

- [x] 支持多文件标签
- [x] 支持 Markdown 源码编辑
- [ ] 支持导出 PDF（后续版本）
`;
  return {
    path: "demo://README.md",
    fileName: "README.md",
    fileSize: new Blob([source]).size,
    encoding: "UTF-8",
    kind: "markdown",
    source,
    contentHash: `demo-${source.length}`,
  };
}

export async function getAppInfo(): Promise<AppInfo> {
  if (!hasTauri()) return { version: "2.1.0-demo" };
  return invoke<AppInfo>("get_app_info");
}

export async function getLaunchPaths(): Promise<string[]> {
  if (!hasTauri()) return [];
  return invoke<string[]>("get_launch_paths");
}

export async function loadXmlFile(path: string): Promise<XmlDocument> {
  if (!hasTauri()) return demoDocument();
  return invoke<XmlDocument>("load_xml_file", { path });
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

export async function loadDocument(path: string): Promise<OpenedDocument> {
  if (!hasTauri()) {
    return isMarkdownPath(path) ? demoMarkdownDocument() : demoDocument();
  }
  if (isMarkdownPath(path)) {
    return invoke<MarkdownDocument>("load_markdown_file", { path });
  }
  return invoke<XmlDocument>("load_xml_file", { path });
}

export async function scanXmlFiles(folder: string): Promise<string[]> {
  if (!hasTauri()) return [demoDocument().path];
  return invoke<string[]>("scan_xml_files", { folder });
}

export async function scanDocuments(folder: string): Promise<string[]> {
  if (!hasTauri()) return [demoDocument().path];
  return invoke<string[]>("scan_document_files", { folder });
}

export async function chooseXmlFiles(): Promise<string[]> {
  if (!hasTauri()) return [demoDocument().path];
  const dialog = await import("@tauri-apps/plugin-dialog");
  const selected = await dialog.open({
    title: "选择 XML 文件",
    multiple: true,
    directory: false,
    filters: [{ name: "XML 文件", extensions: ["xml"] }],
  });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export async function chooseDocuments(): Promise<string[]> {
  if (!hasTauri()) return [demoDocument().path];
  const dialog = await import("@tauri-apps/plugin-dialog");
  const selected = await dialog.open({
    title: "选择 XML 或 Markdown 文件",
    multiple: true,
    directory: false,
    filters: [{ name: "XML / Markdown 文件", extensions: ["xml", "md", "markdown"] }],
  });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export async function chooseFolder(): Promise<string | null> {
  if (!hasTauri()) return null;
  const dialog = await import("@tauri-apps/plugin-dialog");
  const selected = await dialog.open({
    title: "选择包含 XML 或 Markdown 文件的文件夹",
    multiple: false,
    directory: true,
  });
  return typeof selected === "string" ? selected : null;
}

export async function getTableSource(
  path: string,
  tableIndex: number,
  expectedId: string,
): Promise<TableSource> {
  if (!hasTauri()) {
    const table = demoDocument().modules.flatMap((module) => [
      ...module.tables,
      ...module.submodules.flatMap((submodule) => submodule.tables),
    ]).find((item) => item.nodeIndex === tableIndex);
    const columns = table?.columns
      .map((column) => `  <column id="${column.id}" name="${column.name}" type="${column.columnType}" />`)
      .join("\n");
    return {
      tableIndex,
      tableId: expectedId,
      encoding: "UTF-8",
      content: `<table id="${expectedId}" name="${table?.name ?? ""}">\n${columns ?? ""}\n</table>`,
    };
  }
  return invoke<TableSource>("get_table_source", { path, tableIndex, expectedId });
}

export async function saveTableSource(
  path: string,
  tableIndex: number,
  expectedId: string,
  newSource: string,
): Promise<XmlDocument> {
  if (!hasTauri()) {
    const parser = new DOMParser();
    const document = parser.parseFromString(newSource, "application/xml");
    if (document.querySelector("parsererror")) throw new Error("编辑内容不是有效 XML");
    return demoDocument();
  }
  return invoke<XmlDocument>("save_table_source", {
    path,
    tableIndex,
    expectedId,
    newSource,
  });
}

export async function saveMarkdownFile(
  path: string,
  source: string,
  expectedHash: string,
): Promise<MarkdownDocument> {
  if (!hasTauri()) {
    return {
      path,
      fileName: path.split(/[\\/]/).pop() ?? "untitled.md",
      fileSize: new Blob([source]).size,
      encoding: "UTF-8",
      kind: "markdown",
      source,
      contentHash: `demo-${source.length}`,
    };
  }
  return invoke<MarkdownDocument>("save_markdown_file", {
    path,
    newSource: source,
    expectedHash,
  });
}

export async function loadMarkdownAsset(documentPath: string, assetPath: string): Promise<string> {
  if (!hasTauri()) return "";
  return invoke<string>("read_markdown_asset", { documentPath, assetPath });
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!hasTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const opener = await import("@tauri-apps/plugin-opener");
  await opener.openUrl(url);
}

export async function openDefaultAppsSettings(): Promise<void> {
  if (!hasTauri()) return;
  await invoke("open_default_apps_settings");
}

export async function listenForOpenFiles(
  handler: (paths: string[]) => void,
): Promise<() => void> {
  if (!hasTauri()) return () => undefined;
  const event = await import("@tauri-apps/api/event");
  return event.listen<string[]>("open-files", (incoming) => handler(incoming.payload));
}

export function isDesktopApp(): boolean {
  return hasTauri();
}




