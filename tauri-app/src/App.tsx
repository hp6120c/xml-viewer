import { createPortal } from "react-dom";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  AlertCircle,
  CheckCircle2,
  Code2,
  Download,
  Eye,
  FileText,
  FilePlus2,
  FileSpreadsheet,
  FolderOpen,
  Github,
  HelpCircle,
  Link2,
  LoaderCircle,
  Maximize2,
  Minus,
  Minimize2,
  PencilLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Table2,
  X,
} from "lucide-react";
import "./App.css";

import { Sidebar } from "./components/Sidebar";

import { Overview } from "./components/Overview";

import { TableDetail } from "./components/TableDetail";

import { XmlEditor } from "./components/XmlEditor";

import { GenericXmlView } from "./components/GenericXmlView";

import { MarkdownOutline } from "./components/MarkdownOutline";

import { CsvEditor } from "./components/CsvEditor";
import type { CsvEditorHandle } from "./components/CsvEditor";

import { MarkdownSettingsPanel } from "./components/MarkdownSettingsPanel";

import {
  chooseFolder,
  chooseDocuments,
  demoDocument,
  getAppInfo,
  getFullscreenState,
  getLaunchPaths,
  getTableSource,
  isDesktopApp,
  listenForOpenFiles,
  loadDocument,
  openDefaultAppsSettings,
  openExternalUrl,
  saveCsvFile,
  saveMarkdownFile,
  saveTableSource,
  setFullscreen,
  scanDocuments,
  chooseNewDocument,
  createDocument,
} from "./lib/api";

import {
  columnCount,
  filterModules,
  formatBytes,
  moduleCount,
  tableCount,
} from "./lib/xml";

import { loadSession, saveSession } from "./lib/session";
import { checkForUpdate, installUpdate } from "./lib/updater";
import type { UpdateDetails } from "./lib/updater";
import { extractMarkdownHeadings, markdownStats } from "./lib/markdown";
import {
  loadMarkdownSettings,
  saveMarkdownSettings,
} from "./lib/markdown-settings";
import type { CsvDocument, OpenedDocument, TableInfo } from "./types";

const MuyaMarkdownEditor = lazy(() =>
  import("./components/MuyaMarkdownEditor").then((module) => ({
    default: module.MuyaMarkdownEditor,
  })),
);

const MarkdownSourceEditor = lazy(() =>
  import("./components/MarkdownSourceEditor").then((module) => ({
    default: module.MarkdownSourceEditor,
  })),
);

type ViewMode = "overview" | "detail" | "edit" | "markdown-read" | "markdown-edit" | "csv-read" | "csv-edit";
type ToastState = { kind: "success" | "error" | "info"; message: string } | null;
type TabMenuState = { x: number; y: number; path: string } | null;
type CsvBaseline = Pick<CsvDocument, "source" | "encoding" | "contentHash" | "fileSize">;

function csvBaseline(document: CsvDocument): CsvBaseline {
  return {
    source: document.source,
    encoding: document.encoding,
    contentHash: document.contentHash,
    fileSize: document.fileSize,
  };
}

function updateNotes(update: UpdateDetails): string {
  const notes = update.body.trim();
  return notes || "该版本未提供详细更新说明。";
}

async function confirmUpdate(update: UpdateDetails): Promise<boolean> {
  const message = [
    `发现新版本 V${update.version}（当前 V${update.currentVersion}）`,
    update.date ? `发布时间：${update.date}` : "",
    "",
    "更新内容：",
    updateNotes(update),
    "",
    "是否立即下载并安装？",
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "").join("\n");
  if (isDesktopApp()) {
    const dialog = await import("@tauri-apps/plugin-dialog");
    return dialog.confirm(message, {
      title: "发现新版本",
      kind: "info",
      okLabel: "立即更新",
      cancelLabel: "稍后",
    });
  }
  return window.confirm(message);
}

async function confirmAction(
  message: string,
  title: string,
  okLabel: string,
  cancelLabel: string,
): Promise<boolean> {
  if (isDesktopApp()) {
    const dialog = await import("@tauri-apps/plugin-dialog");
    return dialog.ask(message, {
      title,
      kind: "warning",
      okLabel,
      cancelLabel,
    });
  }
  return window.confirm(message);
}

async function askDiscard(message: string): Promise<boolean> {
  return confirmAction(message, "未保存的修改", "放弃修改", "继续编辑");
}

function App() {
  const initialSession = useRef(loadSession());
  const [version, setVersion] = useState("2.3.0");
  const [documents, setDocuments] = useState<OpenedDocument[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [selectedTableIndex, setSelectedTableIndex] = useState<number | null>(null);
  const [mode, setMode] = useState<ViewMode>("overview");
  const [editorContent, setEditorContent] = useState("");
  const [editingTableIndex, setEditingTableIndex] = useState<number | null>(null);
  const [editingTableId, setEditingTableId] = useState<string | null>(null);
  const [editorEncoding, setEditorEncoding] = useState("UTF-8");
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");
  const [zoom, setZoom] = useState(initialSession.current?.zoom ?? 100);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [dragActive, setDragActive] = useState(false);
  const [tabMenu, setTabMenu] = useState<TabMenuState>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [newFileMenuOpen, setNewFileMenuOpen] = useState(false);
  const [markdownSettings, setMarkdownSettings] = useState(loadMarkdownSettings);
  const [markdownSettingsOpen, setMarkdownSettingsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [csvReloadRevision, setCsvReloadRevision] = useState(0);
  const [sidebarWidths, setSidebarWidths] = useState(
    () => initialSession.current?.sidebarWidths ?? { xml: 278, markdown: 260 },
  );

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const sessionReadyRef = useRef(sessionReady);
  sessionReadyRef.current = sessionReady;
  const editorRevisionRef = useRef(0);
  const loadRequestRef = useRef(0);
  const editRequestRef = useRef(0);
  const initializingRef = useRef(true);
  const pendingOpenPathsRef = useRef<string[]>([]);
  const updateCheckingRef = useRef(false);
  const autoUpdateCheckedRef = useRef(false);
  const resizingSidebarRef = useRef(false);
  const markdownBaselineRef = useRef("");
  const markdownSourceRef = useRef("");
  const csvBaselineRef = useRef<CsvBaseline | null>(null);
  const csvSourceRef = useRef("");
  const csvEditorRef = useRef<CsvEditorHandle | null>(null);

  const activeDocument = useMemo(
    () => documents.find((document) => document.path === activePath) ?? null,
    [documents, activePath],
  );
  const activeTables = useMemo(() => {
    if (!activeDocument || activeDocument.kind === "markdown" || activeDocument.kind === "csv") return [];
    return activeDocument.modules.flatMap((module) => [
      ...module.tables,
      ...module.submodules.flatMap((submodule) => submodule.tables),
    ]);
  }, [activeDocument]);
  const activeTable = useMemo(
    () => activeTables.find((table) => table.nodeIndex === selectedTableIndex) ?? null,
    [activeTables, selectedTableIndex],
  );
  const filteredModules = useMemo(
    () => (activeDocument && (activeDocument.kind === "scl" || activeDocument.kind === "xml")
      ? filterModules(activeDocument.modules, search)
      : []),
    [activeDocument, search],
  );
  const markdownHeadings = useMemo(
    () => (activeDocument?.kind === "markdown" ? extractMarkdownHeadings(activeDocument.source) : []),
    [activeDocument],
  );
  const activeMarkdownStats = useMemo(
    () => (activeDocument?.kind === "markdown" ? markdownStats(activeDocument.source) : null),
    [activeDocument],
  );
  const totals = useMemo(
    () => documents.reduce(
      (result, document) => {
        if (document.kind === "markdown" || document.kind === "csv") return result;
        return {
          modules: result.modules + moduleCount(document),
          tables: result.tables + tableCount(document),
          columns: result.columns + columnCount(document),
        };
      },
      { modules: 0, tables: 0, columns: 0 },
    ),
    [documents],
  );

  useEffect(() => {
    if (!isDesktopApp()) return;
    void getFullscreenState().then(setIsFullscreen).catch(() => undefined);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const next = !isFullscreen;
    try {
      await setFullscreen(next);
      setIsFullscreen(next);
    } catch (error) {
      setToast({ kind: "error", message: `切换全屏失败：${String(error)}` });
    }
  }, [isFullscreen]);

  const sidebarWidth = activeDocument?.kind === "markdown"
    ? sidebarWidths.markdown
    : sidebarWidths.xml;

  const startSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizingSidebarRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const moveSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizingSidebarRef.current) return;
    const workspace = event.currentTarget.parentElement;
    if (!workspace) return;
    const rect = workspace.getBoundingClientRect();
    const scale = zoom / 100;
    const next = Math.min(520, Math.max(200, (event.clientX - rect.left) / scale));
    const key = activeDocument?.kind === "markdown" ? "markdown" : "xml";
    setSidebarWidths((current) => ({ ...current, [key]: next }));
  }, [activeDocument, zoom]);

  const stopSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizingSidebarRef.current) return;
    resizingSidebarRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    saveMarkdownSettings(markdownSettings);
  }, [markdownSettings]);

  useEffect(() => {
    if (activeDocument?.kind !== "markdown" || mode === "markdown-edit") {
      setMarkdownSettingsOpen(false);
    }
  }, [activeDocument, mode]);

  useEffect(() => {
    if (!sessionReady) return;
    saveSession({
      paths: documents.map((document) => document.path).filter((path) => !path.startsWith("demo:")),
      activePath: activePath?.startsWith("demo:") ? null : activePath,
      zoom,
      sidebarWidths,
    });
  }, [activePath, documents, sessionReady, sidebarWidths, zoom]);

  const resetWorkspaceView = useCallback((kind?: OpenedDocument["kind"]) => {
    editRequestRef.current += 1;
    setMode(
      kind === "markdown"
        ? "markdown-read"
        : kind === "csv"
          ? "csv-read"
          : "overview",
    );
    setSelectedTableIndex(null);
    setEditingTableIndex(null);
    setEditingTableId(null);
    setEditorContent("");
    editorRevisionRef.current = 0;
    setDirty(false);
  }, []);
  const restoreMarkdownBaseline = useCallback((path = activePath) => {
    if (!path) return;
    const baseline = markdownBaselineRef.current;
    setDocuments((current) => current.map((document) =>
      document.path === path && document.kind === "markdown"
        ? { ...document, source: baseline }
        : document,
    ));
    setEditorContent(baseline);
    markdownSourceRef.current = baseline;
    editorRevisionRef.current = 0;
    dirtyRef.current = false;
    setDirty(false);
  }, [activePath]);

  const restoreCsvBaseline = useCallback((path = activePath) => {
    if (!path) return;
    const baseline = csvBaselineRef.current;
    if (!baseline) return;
    csvSourceRef.current = baseline.source;
    setDocuments((current) => current.map((document) =>
      document.path === path && document.kind === "csv"
        ? { ...document, ...baseline }
        : document,
    ));
    dirtyRef.current = false;
    setDirty(false);
  }, [activePath]);
  const replaceDocument = useCallback((nextDocument: OpenedDocument) => {
    setDocuments((current) =>
      current.map((document) => (document.path === nextDocument.path ? nextDocument : document)),
    );
  }, []);

  const loadPaths = useCallback(async (paths: string[], preferredPath?: string | null) => {
    const unique = Array.from(new Set(paths.filter(Boolean)));
    if (unique.length === 0) return false;
    const requestId = ++loadRequestRef.current;

    if (dirtyRef.current) {
      const discard = await askDiscard("打开其他文件会放弃当前文档尚未保存的修改，是否继续？");
      if (!discard) return false;
      if (activeDocument?.kind === "markdown") restoreMarkdownBaseline(activeDocument.path);
      else if (activeDocument?.kind === "csv") restoreCsvBaseline(activeDocument.path);
      else {
        dirtyRef.current = false;
        setDirty(false);
      }
    }

    setBusy(`正在读取 ${unique.length} 个文件...`);
    const loaded: OpenedDocument[] = [];
    const errors: string[] = [];
    for (let index = 0; index < unique.length; index += 1) {
      if (requestId !== loadRequestRef.current) return false;
      const path = unique[index];
      const existing = documentsRef.current.find((document) => document.path === path);
      if (existing) {
        loaded.push(existing);
        continue;
      }
      setBusy(`正在读取 ${index + 1}/${unique.length}：${path.split(/[\\/]/).pop() ?? path}`);
      try {
        loaded.push(await loadDocument(path));
      } catch (error) {
        errors.push(String(error));
      }
    }

    if (requestId !== loadRequestRef.current) return false;

    if (loaded.length > 0) {
      setDocuments((current) => {
        const map = new Map(current.map((document) => [document.path, document]));
        for (const document of loaded) map.set(document.path, document);
        return Array.from(map.values());
      });
      const destination = loaded.find((document) => document.path === preferredPath) ?? loaded[0];
      setActivePath(destination.path);
      setSearch("");
      resetWorkspaceView(destination.kind);
      if (destination.kind === "markdown") {
        markdownBaselineRef.current = destination.source;
        markdownSourceRef.current = destination.source;
        setEditorContent(destination.source);
      } else if (destination.kind === "csv") {
        csvBaselineRef.current = csvBaseline(destination);
        csvSourceRef.current = destination.source;
      }
    }

    if (errors.length > 0) {
      setToast({
        kind: "error",
        message: `${errors.length} 个文件读取失败：${errors.slice(0, 2).join("；")}`,
      });
    }
    setBusy(null);
    return loaded.length > 0;
  }, [activeDocument, resetWorkspaceView, restoreCsvBaseline, restoreMarkdownBaseline]);

  const loadPathsRef = useRef(loadPaths);
  loadPathsRef.current = loadPaths;

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    void (async () => {
      try {
        const unlisten = await listenForOpenFiles((paths) => {
          if (initializingRef.current) {
            pendingOpenPathsRef.current.push(...paths);
          } else {
            void loadPathsRef.current(paths);
          }
        });
        unlisteners.push(unlisten);
      } catch {
        // Event listening is only available in the desktop shell.
      }

      try {
        const info = await getAppInfo();
        if (!disposed) setVersion(info.version);
      } catch {
        // Version display is non-critical.
      }

      try {
        const launchPaths = await getLaunchPaths();
        const saved = initialSession.current;
        const paths = launchPaths.length > 0 ? launchPaths : (saved?.paths ?? []);
        const preferredPath = launchPaths.length > 0 ? null : saved?.activePath ?? null;
        if (paths.length > 0) {
          await loadPathsRef.current(paths, preferredPath);
        } else if (!disposed) {
          const demo = demoDocument();
          setDocuments([demo]);
          setActivePath(demo.path);
        }
      } catch (error) {
        if (!disposed) {
          setToast({ kind: "error", message: `初始化失败：${String(error)}` });
        }
      }

      initializingRef.current = false;
      if (!disposed) setSessionReady(true);
      const queuedPaths = Array.from(new Set(pendingOpenPathsRef.current));
      pendingOpenPathsRef.current = [];
      if (queuedPaths.length > 0) {
        await loadPathsRef.current(queuedPaths);
      }
      if (isDesktopApp()) {
        try {
          const webviewApi = await import("@tauri-apps/api/webview");
          const unlisten = await webviewApi.getCurrentWebview().onDragDropEvent((event) => {
            if (event.payload.type === "enter") setDragActive(true);
            if (event.payload.type === "leave") setDragActive(false);
            if (event.payload.type === "drop") {
              setDragActive(false);
              const droppedPaths = event.payload.paths;
              void (async () => {
                const expanded: string[] = [];
                for (const path of droppedPaths) {
                  try {
                    expanded.push(...await scanDocuments(path));
                  } catch {
                    expanded.push(path);
                  }
                }
                await loadPathsRef.current(Array.from(new Set(expanded)));
              })();
            }
          });
          unlisteners.push(unlisten);
        } catch {
          // Drag/drop remains available through the toolbar.
        }

        try {
          const windowApi = await import("@tauri-apps/api/window");
          const unlisten = await windowApi.getCurrentWindow().onCloseRequested(async (event) => {
            if (!dirtyRef.current) return;
            event.preventDefault();
            const discard = await askDiscard("当前文档有未保存的修改，确定关闭程序并放弃修改吗？");
            if (discard) {
              dirtyRef.current = false;
              await windowApi.getCurrentWindow().destroy();
            }
          });
          unlisteners.push(unlisten);
        } catch {
          // Browser fallback uses beforeunload.
        }
      }
    })();

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const enterEdit = useCallback(async (table: TableInfo) => {
    if (!activeDocument || activeDocument.kind !== "scl") return;
    if (mode === "edit" && table.nodeIndex === editingTableIndex) return;

    if (mode === "edit" && dirtyRef.current) {
      const discard = await askDiscard("切换表会放弃当前尚未保存的修改，是否继续？");
      if (!discard) return;
    }

    const requestId = ++editRequestRef.current;
    setBusy(`正在读取表 ${table.id}...`);
    try {
      const source = await getTableSource(activeDocument.path, table.nodeIndex, table.id);
      if (requestId !== editRequestRef.current) return;
      setSelectedTableIndex(table.nodeIndex);
      setEditingTableIndex(table.nodeIndex);
      setEditingTableId(table.id);
      setEditorContent(source.content.replace(/\r\n/g, "\n"));
      setEditorEncoding(source.encoding);
      editorRevisionRef.current = 0;
      setDirty(false);
      setMode("edit");
    } catch (error) {
      if (requestId === editRequestRef.current) {
        setToast({ kind: "error", message: String(error) });
      }
    } finally {
      if (requestId === editRequestRef.current) setBusy(null);
    }
  }, [activeDocument, dirty, editingTableIndex, mode]);

  const saveEdit = useCallback(async (exitAfterSave: boolean): Promise<boolean> => {
    if (!activeDocument || activeDocument.kind !== "scl" || editingTableIndex === null || !editingTableId) {
      return false;
    }
    if (!dirty) {
      if (exitAfterSave) setMode("detail");
      return true;
    }
    const sessionId = editRequestRef.current;
    const savedRevision = editorRevisionRef.current;
    setBusy("正在校验并保存...");
    try {
      const nextDocument = await saveTableSource(
        activeDocument.path,
        editingTableIndex,
        editingTableId,
        editorContent,
      );
      replaceDocument(nextDocument);
      if (sessionId !== editRequestRef.current) return true;

      if (editorRevisionRef.current !== savedRevision) {
        setDirty(true);
        setToast({ kind: "error", message: "保存期间内容又发生了变化，磁盘已保存到上一次快照，请再次保存" });
        return false;
      }

      setDirty(false);
      setToast({ kind: "success", message: "表结构已校验并保存" });
      if (exitAfterSave) {
        const stillExists = nextDocument.modules.some((module) =>
          module.tables.some((table) => table.nodeIndex === editingTableIndex)
          || module.submodules.some((submodule) => submodule.tables.some((table) => table.nodeIndex === editingTableIndex)),
        );
        setMode(stillExists ? "detail" : "overview");
        setSelectedTableIndex(stillExists ? editingTableIndex : null);
      }
      return true;
    } catch (error) {
      if (sessionId === editRequestRef.current) {
        setToast({ kind: "error", message: String(error) });
      }
      return false;
    } finally {
      if (sessionId === editRequestRef.current) setBusy(null);
    }
  }, [activeDocument, dirty, editingTableId, editingTableIndex, editorContent, replaceDocument]);

  const saveMarkdownEdit = useCallback(async (exitAfterSave: boolean): Promise<boolean> => {
    if (!activeDocument || activeDocument.kind !== "markdown") return false;
    if (!dirty) {
      if (exitAfterSave) setMode("markdown-read");
      return true;
    }
    const sessionId = editRequestRef.current;
    setBusy("正在保存 Markdown 文档...");
    try {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      });
      const sourceToSave = markdownSourceRef.current || editorContent;
      const savedRevision = editorRevisionRef.current;
      const nextDocument = await saveMarkdownFile(
        activeDocument.path,
        sourceToSave,
        activeDocument.contentHash,
      );
      const changedDuringSave = editorRevisionRef.current !== savedRevision;
      setDocuments((current) => current.map((document) => {
        if (document.path !== activeDocument.path || document.kind !== "markdown") return document;
        if (!changedDuringSave) return nextDocument;
        return {
          ...document,
          contentHash: nextDocument.contentHash,
          fileSize: nextDocument.fileSize,
          encoding: nextDocument.encoding,
        };
      }));
      markdownBaselineRef.current = nextDocument.source;
      markdownSourceRef.current = changedDuringSave
        ? markdownSourceRef.current
        : nextDocument.source;
      if (sessionId !== editRequestRef.current) return true;
      if (changedDuringSave) {
        editorRevisionRef.current = 0;
        dirtyRef.current = true;
        setDirty(true);
        setToast({ kind: "error", message: "保存期间内容又发生了变化，磁盘已保存到上一次快照，请再次保存" });
        return false;
      }
      editorRevisionRef.current = 0;
      dirtyRef.current = false;
      setDirty(false);
      setToast({ kind: "success", message: "Markdown 文档已保存" });
      if (exitAfterSave) setMode("markdown-read");
      return true;
    } catch (error) {
      if (sessionId === editRequestRef.current) {
        setToast({ kind: "error", message: String(error) });
      }
      return false;
    } finally {
      if (sessionId === editRequestRef.current) setBusy(null);
    }
  }, [activeDocument, dirty, editorContent]);

  const handleMarkdownChange = useCallback((nextSource: string) => {
    if (!activeDocument || activeDocument.kind !== "markdown") return;
    setEditorContent(nextSource);
    markdownSourceRef.current = nextSource;
    editorRevisionRef.current += 1;
    dirtyRef.current = true;
    setDirty(true);
    setDocuments((current) => current.map((document) =>
      document.path === activeDocument.path && document.kind === "markdown"
        ? { ...document, source: nextSource }
        : document,
    ));
  }, [activeDocument]);

  const toggleMarkdownSourceMode = useCallback(async () => {
    if (!activeDocument || activeDocument.kind !== "markdown") return;
    if (mode === "markdown-edit") {
      setMode("markdown-read");
      return;
    }
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    });
    setEditorContent(markdownSourceRef.current || activeDocument.source);
    setMode("markdown-edit");
  }, [activeDocument, mode]);

  const handleCsvChange = useCallback((nextSource: string) => {
    if (!activeDocument || activeDocument.kind !== "csv") return;
    const baseline = csvBaselineRef.current;
    const nextDirty = baseline
      ? nextSource !== baseline.source || activeDocument.encoding !== baseline.encoding
      : true;
    csvSourceRef.current = nextSource;
    setDocuments((current) => current.map((document) =>
      document.path === activeDocument.path && document.kind === "csv"
        ? {
            ...document,
            source: nextSource,
            fileSize: new Blob([nextSource]).size,
          }
        : document,
    ));
    editorRevisionRef.current += 1;
    dirtyRef.current = nextDirty;
    setDirty(nextDirty);
  }, [activeDocument]);

  const markCsvDraftDirty = useCallback(() => {
    dirtyRef.current = true;
    setDirty(true);
  }, []);

  const saveCsvEdit = useCallback(async (exitAfterSave: boolean): Promise<boolean> => {
    if (!activeDocument || activeDocument.kind !== "csv") return false;
    const pendingSource = csvEditorRef.current?.flushPendingEdit();
    const sourceToSave = pendingSource ?? csvSourceRef.current ?? activeDocument.source;
    const baseline = csvBaselineRef.current;
    const sourceChanged = baseline ? sourceToSave !== baseline.source : true;
    const encodingChanged = baseline ? activeDocument.encoding !== baseline.encoding : false;
    if (!sourceChanged && !encodingChanged) {
      if (exitAfterSave) setMode("csv-read");
      return true;
    }
    if (encodingChanged) {
      const confirmed = await confirmAction(
        `保存后文件将按 ${activeDocument.encoding} 编码重新写入。\n\n如果当前文本是按错误编码重新读取的乱码，请先取消，再选择正确编码重读或退出编辑模式恢复原内容。`,
        "确认编码转换",
        "转换并保存",
        "取消",
      );
      if (!confirmed) return false;
    }
    const sessionId = editRequestRef.current;
    const savedRevision = editorRevisionRef.current;
    setBusy("正在保存 CSV 表格...");
    try {
      const nextDocument = await saveCsvFile(
        activeDocument.path,
        sourceToSave,
        activeDocument.encoding,
        activeDocument.contentHash,
        baseline?.encoding,
      );
      csvBaselineRef.current = csvBaseline(nextDocument);
      if (editorRevisionRef.current !== savedRevision) {
        setDocuments((current) => current.map((document) =>
          document.path === activeDocument.path && document.kind === "csv"
            ? {
                ...document,
                contentHash: nextDocument.contentHash,
                encoding: nextDocument.encoding,
                fileSize: nextDocument.fileSize,
              }
            : document,
        ));
        dirtyRef.current = true;
        setDirty(true);
        setToast({ kind: "error", message: "保存期间内容又发生了变化，磁盘已保存到上一次快照，请再次保存" });
        return false;
      }
      replaceDocument(nextDocument);
      csvSourceRef.current = nextDocument.source;
      dirtyRef.current = false;
      setDirty(false);
      setToast({ kind: "success", message: "CSV 表格已保存" });
      if (exitAfterSave) setMode("csv-read");
      return true;
    } catch (error) {
      if (sessionId === editRequestRef.current) {
        setToast({ kind: "error", message: String(error) });
      }
      return false;
    } finally {
      if (sessionId === editRequestRef.current) setBusy(null);
    }
  }, [activeDocument, replaceDocument]);

  const toggleCsvEditMode = useCallback(() => {
    if (!activeDocument || activeDocument.kind !== "csv") return;
    if (mode === "csv-edit") csvEditorRef.current?.flushPendingEdit();
    setMode((current) => current === "csv-edit" ? "csv-read" : "csv-edit");
  }, [activeDocument, mode]);

  const changeCsvEncoding = useCallback((encoding: string) => {
    if (!activeDocument || activeDocument.kind !== "csv" || encoding === activeDocument.encoding) return;
    const baseline = csvBaselineRef.current;
    const sourceChanged = baseline ? activeDocument.source !== baseline.source : true;
    const encodingChanged = baseline ? encoding !== baseline.encoding : true;
    setDocuments((current) => current.map((document) =>
      document.path === activeDocument.path && document.kind === "csv"
        ? { ...document, encoding }
        : document,
    ));
    dirtyRef.current = sourceChanged || encodingChanged;
    setDirty(sourceChanged || encodingChanged);
    setToast({
      kind: "info",
      message: `保存 CSV 时将使用 ${encoding} 编码`,
    });
  }, [activeDocument]);

  const reloadCsvEncoding = useCallback(async () => {
    if (!activeDocument || activeDocument.kind !== "csv") return;
    if (dirtyRef.current) {
      const discard = await askDiscard(
        "按编码重新读取会放弃当前尚未保存的修改，是否继续？",
      );
      if (!discard) return;
    }
    setBusy(`正在按 ${activeDocument.encoding} 重新读取 CSV...`);
    try {
      const loaded = await loadDocument(activeDocument.path, activeDocument.encoding);
      if (loaded.kind !== "csv") throw new Error("重新读取后文件类型不是 CSV");
      replaceDocument(loaded);
      csvSourceRef.current = loaded.source;
      const baseline = csvBaselineRef.current;
      const nextDirty = baseline
        ? loaded.source !== baseline.source || loaded.encoding !== baseline.encoding
        : true;
      dirtyRef.current = nextDirty;
      setDirty(nextDirty);
      setCsvReloadRevision((current) => current + 1);
      setMode("csv-read");
      setToast({
        kind: "info",
        message: nextDirty
          ? `已按 ${loaded.encoding} 重读，请确认内容；保存后会按该编码覆盖文件`
          : `已按 ${loaded.encoding} 重新读取 CSV`,
      });
    } catch (error) {
      setToast({ kind: "error", message: `按编码重新读取失败：${String(error)}` });
    } finally {
      setBusy(null);
    }
  }, [activeDocument, replaceDocument]);

  const cancelEdit = useCallback(async () => {
    if (dirty) {
      const discard = await askDiscard(
        activeDocument?.kind === "markdown"
          ? "确定放弃当前 Markdown 文档的修改吗？"
          : activeDocument?.kind === "csv"
            ? "确定放弃当前 CSV 表格的修改吗？"
            : "确定放弃当前表的修改吗？",
      );
      if (!discard) return;
    }
    editRequestRef.current += 1;
    if (activeDocument?.kind === "markdown") restoreMarkdownBaseline(activeDocument.path);
    else if (activeDocument?.kind === "csv") restoreCsvBaseline(activeDocument.path);
    else {
      dirtyRef.current = false;
      setDirty(false);
    }
    setMode(
      activeDocument?.kind === "markdown"
        ? "markdown-read"
        : activeDocument?.kind === "csv"
          ? "csv-read"
          : (activeTable ? "detail" : "overview"),
    );
  }, [activeDocument, activeTable, dirty, restoreCsvBaseline, restoreMarkdownBaseline]);

  const selectTable = useCallback(async (table: TableInfo) => {
    if (mode === "edit") {
      await enterEdit(table);
      return;
    }
    setSelectedTableIndex(table.nodeIndex);
    setMode("detail");
  }, [enterEdit, mode]);
  const activateTab = useCallback(async (path: string) => {
    if (path === activePath) return;
    if (dirty) {
      const discard = await askDiscard("切换标签页会放弃当前尚未保存的修改，是否继续？");
      if (!discard) return;
      if (activeDocument?.kind === "markdown") restoreMarkdownBaseline(activeDocument.path);
      else if (activeDocument?.kind === "csv") restoreCsvBaseline(activeDocument.path);
      else {
        dirtyRef.current = false;
        setDirty(false);
      }
    }
    setActivePath(path);
    const next = documentsRef.current.find((document) => document.path === path);
    resetWorkspaceView(next?.kind);
    if (next?.kind === "markdown") {
      markdownBaselineRef.current = next.source;
      markdownSourceRef.current = next.source;
      setEditorContent(next.source);
    } else if (next?.kind === "csv") {
      csvBaselineRef.current = csvBaseline(next);
      csvSourceRef.current = next.source;
    }
  }, [activeDocument, activePath, dirty, resetWorkspaceView, restoreCsvBaseline, restoreMarkdownBaseline]);

  const closePaths = useCallback(async (pathsToClose: string[]) => {
    const unique = new Set(pathsToClose);
    if (unique.has(activePath ?? "") && dirty) {
      const discard = await askDiscard("关闭当前标签页会放弃尚未保存的修改，是否继续？");
      if (!discard) return;
      if (activeDocument?.kind === "markdown") restoreMarkdownBaseline(activeDocument.path);
      else if (activeDocument?.kind === "csv") restoreCsvBaseline(activeDocument.path);
      else {
        dirtyRef.current = false;
        setDirty(false);
      }
    }
    const currentPaths = documentsRef.current.map((document) => document.path);
    const remaining = currentPaths.filter((path) => !unique.has(path));
    const oldActiveIndex = activePath ? currentPaths.indexOf(activePath) : -1;
    const remainingDocuments = documentsRef.current.filter((document) => !unique.has(document.path));
    setDocuments((current) => current.filter((document) => !unique.has(document.path)));
    if (activePath && unique.has(activePath)) {
      const nextPath = remaining[Math.min(Math.max(oldActiveIndex, 0), Math.max(remaining.length - 1, 0))] ?? null;
      setActivePath(nextPath);
      const next = remainingDocuments.find((document) => document.path === nextPath);
      resetWorkspaceView(next?.kind);
      if (next?.kind === "markdown") {
        markdownBaselineRef.current = next.source;
        markdownSourceRef.current = next.source;
        setEditorContent(next.source);
      } else if (next?.kind === "csv") {
        csvBaselineRef.current = csvBaseline(next);
        csvSourceRef.current = next.source;
      }
    }
    setTabMenu(null);
  }, [activeDocument, activePath, dirty, resetWorkspaceView, restoreCsvBaseline, restoreMarkdownBaseline]);

  const openFiles = useCallback(async () => {
    try {
      const paths = await chooseDocuments();
      await loadPaths(paths);
    } catch (error) {
      setToast({ kind: "error", message: String(error) });
    }
  }, [loadPaths]);

  const createNewDocument = useCallback(async (kind: "markdown" | "xml" | "csv") => {
    try {
      setNewFileMenuOpen(false);
      const path = await chooseNewDocument(kind);
      if (!path) return;
      setBusy("正在创建文件...");
      await createDocument(path, kind);
      const loaded = await loadPaths([path]);
      setBusy(null);
      if (loaded) {
        setToast({
          kind: "success",
          message: kind === "markdown"
            ? "已新建 Markdown 文档"
            : kind === "csv"
              ? "已新建 CSV 表格"
              : "已新建 XML 文档",
        });
      }
    } catch (error) {
      setBusy(null);
      setToast({ kind: "error", message: String(error) });
    }
  }, [loadPaths]);

  const openFolder = useCallback(async () => {
    try {
      const folder = await chooseFolder();
      if (!folder) return;
      setBusy("正在扫描 XML / Markdown / CSV 文件...");
      const paths = await scanDocuments(folder);
      setBusy(null);
      if (paths.length === 0) {
        setToast({ kind: "info", message: "所选目录中没有找到 XML、Markdown 或 CSV 文件" });
        return;
      }
      await loadPaths(paths);
    } catch (error) {
      setBusy(null);
      setToast({ kind: "error", message: String(error) });
    }
  }, [loadPaths]);

  const handleCheckUpdate = useCallback(async (silent: boolean) => {
    if (!isDesktopApp()) {
      if (!silent) setToast({ kind: "info", message: "自动更新仅在安装版桌面程序中可用" });
      return;
    }
    if (updateCheckingRef.current) return;
    updateCheckingRef.current = true;
    if (!silent) setBusy("正在检查更新...");
    try {
      const update = await checkForUpdate();
      if (!update) {
        if (!silent) setToast({ kind: "success", message: "当前已是最新版本" });
        return;
      }
      const confirmed = await confirmUpdate(update);
      if (!confirmed) return;
      if (dirtyRef.current) {
        const discard = await askDiscard(
          "安装更新会关闭程序并放弃当前未保存的修改，是否继续？",
        );
        if (!discard) return;
        dirtyRef.current = false;
        setDirty(false);
      }
      setBusy(`正在下载 V${update.version}...`);
      await installUpdate(update.raw, (event) => {
        if (event.event === "Started") setBusy(`正在下载 V${update.version}...`);
      });
    } catch (error) {
      if (!silent) setToast({ kind: "error", message: `检查更新失败：${String(error)}` });
    } finally {
      updateCheckingRef.current = false;
      if (!silent) setBusy(null);
    }
  }, []);

  useEffect(() => {
    if (!sessionReady || !isDesktopApp() || autoUpdateCheckedRef.current) return;
    autoUpdateCheckedRef.current = true;
    const timer = window.setTimeout(() => void handleCheckUpdate(true), 1800);
    return () => window.clearTimeout(timer);
  }, [handleCheckUpdate, sessionReady]);
  const reloadCurrent = useCallback(async () => {
    if (!activeDocument) return;
    if (dirty) {
      const discard = await askDiscard("刷新会放弃当前尚未保存的修改，是否继续？");
      if (!discard) return;
    }
    setBusy("正在重新读取文件...");
    try {
      const nextDocument = await loadDocument(activeDocument.path);
      replaceDocument(nextDocument);
      if (nextDocument.kind === "markdown") {
        markdownBaselineRef.current = nextDocument.source;
        markdownSourceRef.current = nextDocument.source;
        setEditorContent(nextDocument.source);
        editorRevisionRef.current = 0;
        if (mode === "markdown-edit") setMode("markdown-read");
      } else if (nextDocument.kind === "csv") {
        csvBaselineRef.current = csvBaseline(nextDocument);
        csvSourceRef.current = nextDocument.source;
        setCsvReloadRevision((current) => current + 1);
        editorRevisionRef.current = 0;
        if (mode === "csv-edit") setMode("csv-read");
      } else if (selectedTableIndex !== null) {
        const exists = nextDocument.modules.some((module) =>
          module.tables.some((table) => table.nodeIndex === selectedTableIndex)
          || module.submodules.some((submodule) => submodule.tables.some((table) => table.nodeIndex === selectedTableIndex)),
        );
        setMode(mode === "edit" || !exists ? (exists ? "detail" : "overview") : mode);
      }
      dirtyRef.current = false;
      setDirty(false);
      setToast({ kind: "success", message: "文件已刷新" });
    } catch (error) {
      setToast({ kind: "error", message: String(error) });
    } finally {
      setBusy(null);
    }
  }, [activeDocument, dirty, mode, replaceDocument, selectedTableIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F11" || (event.key === "Escape" && isFullscreen)) {
        event.preventDefault();
        void toggleFullscreen();
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        void createNewDocument("markdown");
        return;
      }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (activeDocument?.kind === "markdown") void saveMarkdownEdit(false);
        else if (activeDocument?.kind === "csv") void saveCsvEdit(false);
        else void saveEdit(false);
      }
      if (event.key.toLowerCase() === "e") {
        event.preventDefault();
        if (activeDocument?.kind === "markdown") {
          void toggleMarkdownSourceMode();
          return;
        } else if (activeDocument?.kind === "csv") {
          toggleCsvEditMode();
          return;
        } else if (mode === "edit") {
          void saveEdit(true);
        } else if (activeTable) {
          void enterEdit(activeTable);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeDocument,
    activeTable,
    createNewDocument,
    enterEdit,
    isFullscreen,
    mode,
    saveEdit,
    saveCsvEdit,
    saveMarkdownEdit,
    toggleCsvEditMode,
    toggleMarkdownSourceMode,
    toggleFullscreen,
  ]);

  const handleTabContextMenu = (event: ReactMouseEvent, path: string) => {
    event.preventDefault();
    setTabMenu({
      x: Math.max(4, Math.min(event.clientX, window.innerWidth - 190)),
      y: Math.max(4, Math.min(event.clientY, window.innerHeight - 190)),
      path,
    });
  };

  const activeIndex = activePath ? documents.findIndex((document) => document.path === activePath) : -1;
  const contextIndex = tabMenu ? documents.findIndex((document) => document.path === tabMenu.path) : -1;

  return (
    <div
      className={`app ${isFullscreen ? "fullscreen-mode" : ""}`}
      style={{ "--app-zoom": zoom / 100 } as CSSProperties}
      data-testid="app"
    >
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark"><Table2 size={22} /></div>
          <div>
            <h1>XML / Markdown / CSV 编辑器</h1>
            <span>
              {activeDocument?.kind === "markdown"
                ? "Markdown 文档"
                : activeDocument?.kind === "csv"
                  ? "CSV 表格"
                  : activeDocument?.kind === "xml"
                    ? "通用 XML 文档"
                    : "SCL Schema XML"}
            </span>
          </div>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="github-chip"
            onClick={() => void openExternalUrl("https://github.com/hp6120c/xml-viewer")}
          >
            <Github size={15} />GitHub
          </button>
          <div className="header-version">V{version}</div>
        </div>
      </header>

      <div className="toolbar">
        <button type="button" className="tool-button" onClick={openFolder}>
          <FolderOpen size={17} />打开文件夹
        </button>
        <div className="new-file-menu">
          <button
            type="button"
            className="tool-button"
            onClick={() => setNewFileMenuOpen((value) => !value)}
          >
            <FilePlus2 size={17} />新建文件
          </button>
          {newFileMenuOpen && (
            <div className="new-file-menu-popup" role="menu">
              <button type="button" role="menuitem" onClick={() => void createNewDocument("markdown")}>
                <FileText size={15} />新建 Markdown 文档
              </button>
              <button type="button" role="menuitem" onClick={() => void createNewDocument("xml")}>
                <Table2 size={15} />新建 XML 文档
              </button>
              <button type="button" role="menuitem" onClick={() => void createNewDocument("csv")}>
                <FileSpreadsheet size={15} />新建 CSV 表格
              </button>
            </div>
          )}
        </div>
        <button type="button" className="tool-button" onClick={openFiles}>
          <FilePlus2 size={17} />打开文件
        </button>
        <button type="button" className="tool-button" onClick={reloadCurrent} disabled={!activeDocument || mode === "edit"}>
          <RefreshCw size={17} />刷新
        </button>
        {activeDocument?.kind === "markdown" ? (
          <>
            <button
              type="button"
              className={`tool-button ${mode === "markdown-edit" ? "active" : ""}`}
              onClick={() => void toggleMarkdownSourceMode()}
              title={mode === "markdown-edit" ? "切换到所见即所得模式（Ctrl+E）" : "切换到 Markdown 源码模式（Ctrl+E）"}
            >
              {mode === "markdown-edit" ? <Eye size={17} /> : <Code2 size={17} />}
              {mode === "markdown-edit" ? "所见即所得" : "源码模式"}
            </button>
            <button
              type="button"
              className="tool-button"
              onClick={() => void saveMarkdownEdit(false)}
              disabled={!dirty}
            >
              <Save size={17} />保存更改
            </button>
          </>
        ) : activeDocument?.kind === "csv" ? (
          <>
            <button
              type="button"
              className={`tool-button ${mode === "csv-edit" ? "active" : ""}`}
              onClick={toggleCsvEditMode}
              title={mode === "csv-edit" ? "切换到阅读模式（Ctrl+E）" : "切换到编辑模式（Ctrl+E）"}
            >
              {mode === "csv-edit" ? <Eye size={17} /> : <PencilLine size={17} />}
              {mode === "csv-edit" ? "阅读模式" : "编辑模式"}
            </button>
            <button
              type="button"
              className="tool-button"
              onClick={() => void saveCsvEdit(false)}
              disabled={!dirty}
            >
              <Save size={17} />保存表格
            </button>
            {dirty && (
              <button
                type="button"
                className="tool-button"
                onClick={() => void cancelEdit()}
                title="恢复到最近一次保存的内容和编码"
              >
                <RotateCcw size={17} />放弃修改
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            className={`tool-button ${mode === "edit" ? "active" : ""}`}
            onClick={() => {
              if (mode === "edit") {
                void saveEdit(true);
              } else if (activeTable) {
                void enterEdit(activeTable);
              } else {
                setToast({ kind: "info", message: "请先在左侧或目录中选择一张表" });
              }
            }}
            disabled={
              !activeDocument
              || activeDocument.kind === "xml"
              || (activeDocument.kind === "scl" && mode !== "edit" && !activeTable)
            }
          >
            <PencilLine size={17} />
            {mode === "edit" ? "保存并阅读" : "编辑模式"}
          </button>
        )}

        <label className="search-box" style={{ display: activeDocument?.kind === "csv" ? "none" : undefined }}>
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              activeDocument?.kind === "markdown"
                ? "搜索文档标题..."
                : "搜索表名、字段名或备注..."
            }
            aria-label="搜索表名、字段名或备注"
            disabled={activeDocument?.kind === "xml"}
          />
          {search && (
            <button type="button" className="search-clear" onClick={() => setSearch("")} title="清空搜索">
              <X size={14} />
            </button>
          )}
        </label>

        {activeDocument?.kind === "markdown" && (
          <button
            type="button"
            className="tool-button"
            onClick={() => setMarkdownSettingsOpen(true)}
            disabled={mode === "markdown-edit"}
            title={mode === "markdown-edit" ? "切回所见即所得模式后调整阅读样式" : "调整 Markdown 阅读样式"}
          >
            <SlidersHorizontal size={17} />基础样式
          </button>
        )}

        <div className="toolbar-spacer" />

        <div className="zoom-control" title="界面缩放">
          <button type="button" aria-label="缩小界面" title="缩小界面" disabled={zoom <= 80} onClick={() => setZoom((value) => Math.max(80, value - 10))}><Minus size={14} /></button>
          <span>{zoom}%</span>
          <button type="button" aria-label="放大界面" title="放大界面" disabled={zoom >= 140} onClick={() => setZoom((value) => Math.min(140, value + 10))}><Plus size={14} /></button>
          <button type="button" onClick={() => setZoom(100)} aria-label="恢复默认缩放" title="恢复默认缩放"><RotateCcw size={13} /></button>
        </div>

        <button
          type="button"
          className="tool-button"
          onClick={() => void toggleFullscreen()}
          title={isFullscreen ? "退出全屏（F11）" : "全屏（F11）"}
        >
          {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          {isFullscreen ? "退出全屏" : "全屏"}
        </button>

        <button type="button" className="tool-button" onClick={() => void handleCheckUpdate(false)}>
          <Download size={17} />检查更新
        </button>

        <button
          type="button"
          className="tool-button"
          onClick={async () => {
            try {
              await openDefaultAppsSettings();
              setToast({ kind: "info", message: "已打开 Windows 默认应用设置，请按文件类型选择本程序" });
            } catch (error) {
              setToast({ kind: "error", message: String(error) });
            }
          }}
        >
          <Settings2 size={17} />默认应用设置
        </button>
      </div>

      <div className="stats-bar">
        {activeDocument?.kind === "markdown" ? (
          <>
            <span>标题 <strong>{activeMarkdownStats?.headingCount ?? 0}</strong></span>
            <span>字数 <strong>{activeMarkdownStats?.wordCount.toLocaleString() ?? 0}</strong></span>
            <span>预计阅读 <strong>{activeMarkdownStats?.readingMinutes ?? 0} 分钟</strong></span>
          </>
        ) : activeDocument?.kind === "csv" ? (
          <>
            <span>CSV 表格</span>
            <span>编码 <strong>{activeDocument.encoding}</strong></span>
            <span>可筛选、排序并滚动浏览全部数据</span>
          </>
        ) : (
          <>
            <span>模块 <strong>{totals.modules}</strong></span>
            <span>表 <strong>{totals.tables}</strong></span>
            <span>字段 <strong>{totals.columns}</strong></span>
          </>
        )}
        <span className="stats-file">
          {activeDocument
            ? `当前：${activeDocument.fileName} · ${formatBytes(activeDocument.fileSize)}`
            : "请打开 XML、Markdown 或 CSV 文件"}
        </span>
      </div>

      {documents.length > 0 && (
        <div className="tab-bar" data-testid="tab-bar" role="tablist" aria-label="已打开文件">
          {documents.map((document) => {
            const active = document.path === activePath;
            return (
              <div className={`file-tab-wrap ${active ? "active" : ""}`} key={document.path}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className="file-tab"
                  onClick={() => void activateTab(document.path)}
                  onContextMenu={(event) => handleTabContextMenu(event, document.path)}
                  title={document.path}
                >
                  {document.kind === "markdown"
                    ? <FileText size={13} className="tab-type-icon md" />
                    : document.kind === "csv"
                      ? <FileSpreadsheet size={13} className="tab-type-icon csv" />
                      : <Table2 size={13} className="tab-type-icon xml" />}
                  <span className={`tab-kind ${document.kind === "markdown" ? "md" : document.kind === "csv" ? "csv" : "xml"}`}>
                    {document.kind === "markdown" ? "MD" : document.kind === "csv" ? "CSV" : "XML"}
                  </span>
                  <span className="tab-file-name">{document.fileName.replace(/^scl_schema_/i, "")}</span>
                  {active && dirty && <span className="tab-dirty-dot" aria-label="有未保存的修改" />}
                </button>
                <button
                  type="button"
                  className="tab-close"
                  aria-label={`关闭 ${document.fileName}`}
                  onClick={() => void closePaths([document.path])}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
          {isFullscreen && (
            <>
              <span className="fullscreen-tab-spacer" />
              <button
                type="button"
                className="fullscreen-exit"
                onClick={() => void toggleFullscreen()}
                title="退出全屏（F11 / Esc）"
              >
                <Minimize2 size={14} />退出全屏
              </button>
            </>
          )}
        </div>
      )}
      {isFullscreen && documents.length === 0 && (
        <button
          type="button"
          className="fullscreen-empty-exit"
          onClick={() => void toggleFullscreen()}
          title="退出全屏（F11 / Esc）"
        >
          <Minimize2 size={15} />退出全屏
        </button>
      )}
      <main
        className={`workspace ${activeDocument?.kind === "xml" ? "generic-workspace" : ""} ${activeDocument?.kind === "markdown" ? "markdown-workspace" : ""} ${activeDocument?.kind === "csv" ? "csv-workspace" : ""} ${activeDocument ? "" : "empty-workspace"}`}
        style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      >
        {activeDocument ? (
          activeDocument.kind === "markdown" ? (
            <>
              <MarkdownOutline
                headings={markdownHeadings}
                fileName={activeDocument.fileName}
                search={search}
                settings={markdownSettings}
                onSelectHeading={(index) => {
                  const heading = document.querySelectorAll<HTMLElement>(
                    '[data-testid="content-pane"] .mu-atx-heading, [data-testid="content-pane"] .mu-setext-heading',
                  )[index];
                  heading?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />
              <div
                className="sidebar-resizer"
                role="separator"
                aria-label="调整 Markdown 导航栏宽度"
                aria-orientation="vertical"
                onPointerDown={startSidebarResize}
                onPointerMove={moveSidebarResize}
                onPointerUp={stopSidebarResize}
                onPointerCancel={stopSidebarResize}
              />
              <section className="content-pane markdown-content-pane" data-testid="content-pane">
                {mode === "markdown-edit" ? (
                  <div className="markdown-source-shell" data-testid="markdown-source-page">
                    <Suspense fallback={<div className="muya-loading">正在加载 Markdown 源码编辑器...</div>}>
                      <MarkdownSourceEditor
                        value={editorContent}
                        onChange={handleMarkdownChange}
                      />
                    </Suspense>
                  </div>
                ) : (
                  <Suspense fallback={<div className="muya-loading">正在加载 Markdown 编辑器...</div>}>
                    <MuyaMarkdownEditor
                      source={activeDocument.source}
                      currentPath={activeDocument.path}
                      settings={markdownSettings}
                      onChange={handleMarkdownChange}
                      onOpenLocalPath={(path) => void loadPaths([path])}
                    />
                  </Suspense>
                )}
              </section>
            </>
          ) : activeDocument.kind === "csv" ? (
            <section className="content-pane csv-content-pane" data-testid="content-pane">
              <CsvEditor
                key={`${activeDocument.path}:${csvReloadRevision}`}
                ref={csvEditorRef}
                source={activeDocument.source}
                encoding={activeDocument.encoding}
                fileName={activeDocument.fileName}
                readOnly={mode !== "csv-edit"}
                onSourceChange={handleCsvChange}
                onEncodingChange={changeCsvEncoding}
                onReloadEncoding={() => void reloadCsvEncoding()}
                onDraftChange={markCsvDraftDirty}
              />
            </section>
          ) : activeDocument.kind === "xml" ? (
            <section className="content-pane" data-testid="content-pane">
              <GenericXmlView document={activeDocument} />
            </section>
          ) : (
            <>
              <Sidebar
                document={activeDocument}
                modules={filteredModules}
                search={search}
                selectedTableIndex={selectedTableIndex}
                onSelectTable={(table) => void selectTable(table)}
              />
              <div
                className="sidebar-resizer"
                role="separator"
                aria-label="调整 XML 数据表导航栏宽度"
                aria-orientation="vertical"
                onPointerDown={startSidebarResize}
                onPointerMove={moveSidebarResize}
                onPointerUp={stopSidebarResize}
                onPointerCancel={stopSidebarResize}
              />
              <section className="content-pane" data-testid="content-pane">
                {mode === "overview" && (
                  <Overview
                    document={activeDocument}
                    modules={filteredModules}
                    search={search}
                    onSelectTable={(table) => void selectTable(table)}
                  />
                )}
                {mode === "detail" && activeTable && (
                  <TableDetail
                    table={activeTable}
                    onBack={() => {
                      setMode("overview");
                      setSelectedTableIndex(null);
                    }}
                    onEdit={() => void enterEdit(activeTable)}
                  />
                )}
                {mode === "detail" && !activeTable && (
                  <Overview
                    document={activeDocument}
                    modules={filteredModules}
                    search={search}
                    onSelectTable={(table) => void selectTable(table)}
                  />
                )}
                {mode === "edit" && activeTable && (
                  <div className="edit-page" data-testid="edit-page">
                    <div className="edit-heading">
                      <div>
                        <div className="eyebrow">编辑器 · {editorEncoding}</div>
                        <h1>{editingTableId}</h1>
                        <p>{dirty ? "有未保存的修改" : "内容已与磁盘同步"}</p>
                      </div>
                      <div className="edit-actions">
                        <button type="button" className="secondary-button" onClick={() => void cancelEdit()}>
                          取消
                        </button>
                        <button type="button" className="secondary-button" onClick={() => void saveEdit(false)} disabled={!dirty}>
                          <Save size={16} />仅保存
                        </button>
                        <button type="button" className="primary-button" onClick={() => void saveEdit(true)}>
                          <CheckCircle2 size={16} />校验并阅读
                        </button>
                      </div>
                    </div>
                    <div className="editor-shell">
                      <XmlEditor value={editorContent} onChange={(value) => {
                        setEditorContent(value);
                        editorRevisionRef.current += 1;
                        setDirty(true);
                      }} />
                    </div>
                  </div>
                )}
              </section>
            </>
          )
        ) : (
          <div className="welcome" data-testid="welcome">
            <div className="welcome-icon"><Table2 size={42} /></div>
            <h1>打开 XML、Markdown 或 CSV 文件</h1>
            <p>支持 SCL Schema 数据库结构查看、Markdown 文档编辑和 CSV 表格阅读/编辑，所有文件都在同一套标签页中管理。</p>
            <div className="welcome-actions">
              <button type="button" className="primary-button" onClick={openFolder}>
                <FolderOpen size={17} />打开文件夹
              </button>
              <button type="button" className="secondary-button" onClick={openFiles}>
                <FilePlus2 size={17} />打开 XML / Markdown / CSV 文件
              </button>
            </div>
            <div className="welcome-hint"><HelpCircle size={15} />也可以直接把 XML、Markdown 或 CSV 文件拖进窗口</div>
          </div>
        )}
      </main>

      {dragActive && (
        <div className="drop-overlay">
          <FolderOpen size={44} />
          <strong>松开以打开 XML、Markdown、CSV 文件或文件夹</strong>
        </div>
      )}

      {busy && (
        <div className="busy-overlay" role="status" aria-live="polite">
          <div className="busy-card"><LoaderCircle size={22} className="spin" /><span>{busy}</span></div>
        </div>
      )}

      {toast && (
        <div className={`toast ${toast.kind}`} data-testid="toast" role={toast.kind === "error" ? "alert" : "status"} aria-live="polite">
          {toast.kind === "success" ? <CheckCircle2 size={18} /> : toast.kind === "error" ? <AlertCircle size={18} /> : <Link2 size={18} />}
          <span>{toast.message}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setToast(null)}><X size={14} /></button>
        </div>
      )}

      <MarkdownSettingsPanel
        open={markdownSettingsOpen}
        settings={markdownSettings}
        onChange={setMarkdownSettings}
        onClose={() => setMarkdownSettingsOpen(false)}
      />

      {tabMenu && createPortal(
        <>
          <div
            className="context-backdrop"
            onClick={() => setTabMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setTabMenu(null);
            }}
          />
          <div className="context-menu" role="menu" style={{ left: tabMenu.x, top: tabMenu.y }}>
            <button type="button" role="menuitem" onClick={() => {
              const paths = documents.slice(contextIndex + 1).map((document) => document.path);
              void closePaths(paths);
            }} disabled={contextIndex >= documents.length - 1}>关闭右侧标签页</button>
            <button type="button" role="menuitem" onClick={() => {
              const paths = documents.filter((document) => document.path !== tabMenu.path).map((document) => document.path);
              void closePaths(paths);
            }} disabled={documents.length <= 1}>关闭其他标签页</button>
            <button type="button" role="menuitem" onClick={() => void closePaths(documents.map((document) => document.path))}>关闭所有标签页</button>
            <hr />
            <button type="button" role="menuitem" onClick={() => {
              void activateTab(tabMenu.path);
              setTabMenu(null);
            }}>切换到该标签页</button>
          </div>
        </>,
        document.body,
      )}
      <footer className="app-footer">
        <span className="footer-meta">
          {activeDocument
            ? `${activeDocument.encoding} · ${activeDocument.kind === "markdown" ? "Markdown" : activeDocument.kind === "csv" ? "CSV" : activeDocument.rootTag}`
            : "就绪"}
        </span>
        <strong className="footer-author">Designed and developed by Austin.H</strong>
        <span className="footer-meta footer-tab-status">
          {activeIndex >= 0 ? `标签 ${activeIndex + 1}/${documents.length}` : `${documents.length} 个文件`}
        </span>
      </footer>
    </div>
  );
}

export default App;



























