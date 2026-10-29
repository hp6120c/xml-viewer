import { createPortal } from "react-dom";

import {
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
  Download,
  FileText,
  FilePlus2,
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

import { MarkdownEditor } from "./components/MarkdownEditor";

import { MarkdownOutline } from "./components/MarkdownOutline";

import { MarkdownSettingsPanel } from "./components/MarkdownSettingsPanel";

import { MarkdownView } from "./components/MarkdownView";

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
import { extractMarkdownHeadings, markdownStats } from "./lib/markdown";
import {
  loadMarkdownSettings,
  saveMarkdownSettings,
} from "./lib/markdown-settings";
import type { OpenedDocument, TableInfo } from "./types";

type ViewMode = "overview" | "detail" | "edit" | "markdown-read" | "markdown-edit";
type ToastState = { kind: "success" | "error" | "info"; message: string } | null;
type TabMenuState = { x: number; y: number; path: string } | null;

async function confirmUpdate(message: string): Promise<boolean> {
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

async function askDiscard(message: string): Promise<boolean> {
  if (isDesktopApp()) {
    const dialog = await import("@tauri-apps/plugin-dialog");
    return dialog.ask(message, {
      title: "未保存的修改",
      kind: "warning",
      okLabel: "放弃修改",
      cancelLabel: "继续编辑",
    });
  }
  return window.confirm(message);
}

function App() {
  const initialSession = useRef(loadSession());
  const [version, setVersion] = useState("2.1.0");
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

  const activeDocument = useMemo(
    () => documents.find((document) => document.path === activePath) ?? null,
    [documents, activePath],
  );
  const activeTables = useMemo(() => {
    if (!activeDocument || activeDocument.kind === "markdown") return [];
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
    () => (activeDocument && activeDocument.kind !== "markdown"
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
        if (document.kind === "markdown") return result;
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

  const resetWorkspaceView = useCallback((markdown = false) => {
    editRequestRef.current += 1;
    setMode(markdown ? "markdown-read" : "overview");
    setSelectedTableIndex(null);
    setEditingTableIndex(null);
    setEditingTableId(null);
    setEditorContent("");
    editorRevisionRef.current = 0;
    setDirty(false);
  }, []);

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
      resetWorkspaceView(destination.kind === "markdown");
    }

    if (errors.length > 0) {
      setToast({
        kind: "error",
        message: `${errors.length} 个文件读取失败：${errors.slice(0, 2).join("；")}`,
      });
    }
    setBusy(null);
    return loaded.length > 0;
  }, [resetWorkspaceView]);

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

  const enterMarkdownEdit = useCallback(async () => {
    if (!activeDocument || activeDocument.kind !== "markdown") return;
    if (mode === "markdown-edit") return;
    const preservePreviewStyles = mode === "markdown-read" && dirtyRef.current;
    if (dirtyRef.current && !preservePreviewStyles) {
      const discard = await askDiscard("进入 Markdown 编辑会放弃当前尚未保存的修改，是否继续？");
      if (!discard) return;
    }
    setEditorContent(activeDocument.source.replace(/\r\n/g, "\n"));
    setEditorEncoding(activeDocument.encoding);
    if (!preservePreviewStyles) {
      editorRevisionRef.current = 0;
      setDirty(false);
    }
    setMode("markdown-edit");
  }, [activeDocument, mode]);

  const saveMarkdownEdit = useCallback(async (exitAfterSave: boolean): Promise<boolean> => {
    if (!activeDocument || activeDocument.kind !== "markdown") return false;
    if (!dirty) {
      if (exitAfterSave) setMode("markdown-read");
      return true;
    }
    const sessionId = editRequestRef.current;
    const savedRevision = editorRevisionRef.current;
    setBusy("正在保存 Markdown 文档...");
    try {
      const nextDocument = await saveMarkdownFile(
        activeDocument.path,
        editorContent,
        activeDocument.contentHash,
      );
      replaceDocument(nextDocument);
      if (sessionId !== editRequestRef.current) return true;
      if (editorRevisionRef.current !== savedRevision) {
        setDirty(true);
        setToast({ kind: "error", message: "保存期间内容又发生了变化，磁盘已保存到上一次快照，请再次保存" });
        return false;
      }
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
  }, [activeDocument, dirty, editorContent, replaceDocument]);

  const applyMarkdownLocalStyle = useCallback((nextSource: string) => {
    if (!activeDocument || activeDocument.kind !== "markdown") return;
    setEditorContent(nextSource);
    editorRevisionRef.current += 1;
    setDirty(true);
    setDocuments((current) => current.map((document) =>
      document.path === activeDocument.path && document.kind === "markdown"
        ? { ...document, source: nextSource }
        : document,
    ));
    setToast({ kind: "info", message: "局部样式已应用，按 Ctrl+S 或点击“保存更改”写入 Markdown" });
  }, [activeDocument]);

  const cancelEdit = useCallback(async () => {
    if (dirty) {
      const discard = await askDiscard(
        activeDocument?.kind === "markdown" ? "确定放弃当前 Markdown 文档的修改吗？" : "确定放弃当前表的修改吗？",
      );
      if (!discard) return;
    }
    editRequestRef.current += 1;
    setDirty(false);
    setMode(activeDocument?.kind === "markdown" ? "markdown-read" : (activeTable ? "detail" : "overview"));
  }, [activeDocument, activeTable, dirty]);

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
      dirtyRef.current = false;
      setDirty(false);
    }
    setActivePath(path);
    const next = documentsRef.current.find((document) => document.path === path);
    resetWorkspaceView(next?.kind === "markdown");
  }, [activePath, dirty, resetWorkspaceView]);

  const closePaths = useCallback(async (pathsToClose: string[]) => {
    const unique = new Set(pathsToClose);
    if (unique.has(activePath ?? "") && dirty) {
      const discard = await askDiscard("关闭当前标签页会放弃尚未保存的修改，是否继续？");
      if (!discard) return;
      dirtyRef.current = false;
      setDirty(false);
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
      resetWorkspaceView(next?.kind === "markdown");
    }
    setTabMenu(null);
  }, [activePath, dirty, resetWorkspaceView]);

  const openFiles = useCallback(async () => {
    try {
      const paths = await chooseDocuments();
      await loadPaths(paths);
    } catch (error) {
      setToast({ kind: "error", message: String(error) });
    }
  }, [loadPaths]);

  const createNewDocument = useCallback(async (kind: "markdown" | "xml") => {
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
          message: kind === "markdown" ? "已新建 Markdown 文档" : "已新建 XML 文档",
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
      setBusy("正在扫描 XML / Markdown 文件...");
      const paths = await scanDocuments(folder);
      setBusy(null);
      if (paths.length === 0) {
        setToast({ kind: "info", message: "所选目录中没有找到 XML 或 Markdown 文件" });
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
      const confirmed = await confirmUpdate(
        `发现新版本 V${update.version}（当前 V${update.currentVersion}）${update.date ? `\n发布时间：${update.date}` : ""}\n\n是否立即下载并安装？`,
      );
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
        if (mode === "markdown-edit") setMode("markdown-read");
      } else if (selectedTableIndex !== null) {
        const exists = nextDocument.modules.some((module) =>
          module.tables.some((table) => table.nodeIndex === selectedTableIndex)
          || module.submodules.some((submodule) => submodule.tables.some((table) => table.nodeIndex === selectedTableIndex)),
        );
        setMode(mode === "edit" || !exists ? (exists ? "detail" : "overview") : mode);
      }
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
        else void saveEdit(false);
      }
      if (event.key.toLowerCase() === "e") {
        event.preventDefault();
        if (activeDocument?.kind === "markdown") {
          if (mode === "markdown-edit") void saveMarkdownEdit(true);
          else void enterMarkdownEdit();
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
    enterMarkdownEdit,
    isFullscreen,
    mode,
    saveEdit,
    saveMarkdownEdit,
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
            <h1>XML / Markdown 编辑器</h1>
            <span>
              {activeDocument?.kind === "markdown"
                ? "Markdown 文档 · Tauri 2"
                : activeDocument?.kind === "xml"
                  ? "通用 XML 文档 · Tauri 2"
                  : "SCL Schema XML · Tauri 2"}
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
            </div>
          )}
        </div>
        <button type="button" className="tool-button" onClick={openFiles}>
          <FilePlus2 size={17} />打开文件
        </button>
        <button type="button" className="tool-button" onClick={reloadCurrent} disabled={!activeDocument || mode === "edit" || mode === "markdown-edit"}>
          <RefreshCw size={17} />刷新
        </button>
        <button
          type="button"
          className={`tool-button ${mode === "edit" || mode === "markdown-edit" ? "active" : ""}`}
          onClick={() => {
            if (activeDocument?.kind === "markdown") {
              if (mode === "markdown-edit") void saveMarkdownEdit(true);
              else if (dirtyRef.current) void saveMarkdownEdit(false);
              else void enterMarkdownEdit();
            } else if (mode === "edit") {
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
          {activeDocument?.kind === "markdown"
            ? <FileText size={17} />
            : <PencilLine size={17} />}
          {mode === "edit" || mode === "markdown-edit"
            ? "保存并阅读"
            : activeDocument?.kind === "markdown" && dirty
              ? "保存更改"
              : "编辑模式"}
        </button>

        <label className="search-box">
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
            title={mode === "markdown-edit" ? "切回阅读模式后调整预览样式" : "调整 Markdown 阅读样式"}
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
            : "请打开 XML 或 Markdown 文件"}
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
                    : <Table2 size={13} className="tab-type-icon xml" />}
                  <span className={`tab-kind ${document.kind === "markdown" ? "md" : "xml"}`}>
                    {document.kind === "markdown" ? "MD" : "XML"}
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
        className={`workspace ${activeDocument?.kind === "xml" ? "generic-workspace" : ""} ${activeDocument?.kind === "markdown" ? "markdown-workspace" : ""} ${activeDocument ? "" : "empty-workspace"}`}
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
                  <div className="markdown-edit-page" data-testid="markdown-edit-page">
                    <div className="edit-heading">
                      <div>
                        <div className="eyebrow">Markdown 编辑器 · {editorEncoding}</div>
                        <h1>{activeDocument.fileName}</h1>
                        <p>{dirty ? "有未保存的修改" : "内容已与磁盘同步"}</p>
                      </div>
                      <div className="edit-actions">
                        <button type="button" className="secondary-button" onClick={() => void cancelEdit()}>
                          取消
                        </button>
                        <button type="button" className="secondary-button" onClick={() => void saveMarkdownEdit(false)} disabled={!dirty}>
                          <Save size={16} />仅保存
                        </button>
                        <button type="button" className="primary-button" onClick={() => void saveMarkdownEdit(true)}>
                          <CheckCircle2 size={16} />保存并阅读
                        </button>
                      </div>
                    </div>
                    <div className="editor-shell markdown-editor-shell">
                      <MarkdownEditor
                        value={editorContent}
                        onChange={(value) => {
                          setEditorContent(value);
                          editorRevisionRef.current += 1;
                          setDirty(true);
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <MarkdownView
                    source={activeDocument.source}
                    currentPath={activeDocument.path}
                    settings={markdownSettings}
                    onLocalStyleChange={applyMarkdownLocalStyle}
                    onLocalStyleError={(message) => setToast({ kind: "error", message })}
                    onOpenLocalPath={(path) => void loadPaths([path])}
                  />
                )}
              </section>
            </>
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
            <h1>打开 XML 或 Markdown 文档</h1>
            <p>支持 SCL Schema 数据库结构查看、Markdown 文档阅读和直接编辑，所有文件都在同一套标签页中管理。</p>
            <div className="welcome-actions">
              <button type="button" className="primary-button" onClick={openFolder}>
                <FolderOpen size={17} />打开文件夹
              </button>
              <button type="button" className="secondary-button" onClick={openFiles}>
                <FilePlus2 size={17} />打开 XML / Markdown 文件
              </button>
            </div>
            <div className="welcome-hint"><HelpCircle size={15} />也可以直接把 XML 或 Markdown 文件拖进窗口</div>
          </div>
        )}
      </main>

      {dragActive && (
        <div className="drop-overlay">
          <FolderOpen size={44} />
          <strong>松开以打开 XML / Markdown 文件或文件夹</strong>
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
        <span>
          {activeDocument
            ? `${activeDocument.encoding} · ${activeDocument.kind === "markdown" ? "Markdown" : activeDocument.rootTag}`
            : "就绪"}
        </span>
        <span>{activeIndex >= 0 ? `标签 ${activeIndex + 1}/${documents.length}` : `${documents.length} 个文件`}</span>
      </footer>
    </div>
  );
}

export default App;



























