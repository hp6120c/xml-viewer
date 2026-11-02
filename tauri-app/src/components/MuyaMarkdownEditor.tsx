import { useEffect, useRef, type CSSProperties } from "react";
import {
  CodeBlockLanguageSelector,
  EmojiSelector,
  FootnoteTool,
  ImageResizeBar,
  ImageToolBar,
  InlineFormatToolbar,
  LinkTools,
  Muya,
  ParagraphFrontButton,
  ParagraphFrontMenu,
  ParagraphQuickInsertMenu,
  PreviewToolBar,
  TableColumnToolbar,
  TableDragBar,
  TableRowColumMenu,
  zh,
} from "@muyajs/core";
import "@muyajs/core/lib/core.css";
import { loadMarkdownAsset, openExternalUrl } from "../lib/api";
import {
  isExternalMarkdownUrl,
  isSafeMarkdownUrl,
  resolveMarkdownLocalPath,
  slugifyMarkdownHeading,
} from "../lib/markdown";
import {
  markdownSettingsVars,
  type MarkdownReadingSettings,
} from "../lib/markdown-settings";
import "./muya-markdown.css";

interface MuyaMarkdownEditorProps {
  source: string;
  currentPath: string;
  settings: MarkdownReadingSettings;
  onChange: (markdown: string) => void;
  onOpenLocalPath?: (path: string) => void;
}

interface PreparedMarkdown {
  markdown: string;
  restore: (value: string) => string;
}

type MuyaSelection = NonNullable<ReturnType<Muya["editor"]["selection"]["getSelection"]>>;

let pluginsRegistered = false;
let markdownLinkHandler: ((href: string) => void) | null = null;
const MARKDOWN_IMAGE_SOURCE_PATTERN = /(!\[[^\]]*\]\(\s*)(<[^>\r\n]+>|[^\s)]+)/g;

function markdownFenceRanges(source: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let fence: { character: string; length: number; start: number } | null = null;
  let lineStart = 0;
  while (lineStart <= source.length) {
    const lineEnd = source.indexOf("\n", lineStart);
    const end = lineEnd < 0 ? source.length : lineEnd + 1;
    const line = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd);
    if (!fence) {
      const opening = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (opening) {
        fence = {
          character: opening[1][0],
          length: opening[1].length,
          start: lineStart,
        };
      }
    } else {
      const closing = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (
        closing
        && closing[1][0] === fence.character
        && closing[1].length >= fence.length
      ) {
        ranges.push({ start: fence.start, end });
        fence = null;
      }
    }
    if (lineEnd < 0) break;
    lineStart = end;
  }
  if (fence) ranges.push({ start: fence.start, end: source.length });
  return ranges;
}

function isInsideMarkdownCode(
  source: string,
  offset: number,
  fenceRanges: Array<{ start: number; end: number }>,
): boolean {
  if (fenceRanges.some((range) => offset >= range.start && offset < range.end)) return true;
  const lineStart = source.lastIndexOf("\n", offset) + 1;
  let backticks = 0;
  for (let index = lineStart; index < offset; index += 1) {
    if (source[index] === "`") backticks += 1;
  }
  return backticks % 2 === 1;
}

function registerMuyaPlugins() {
  if (pluginsRegistered) return;
  Muya.use(InlineFormatToolbar);
  Muya.use(EmojiSelector);
  Muya.use(CodeBlockLanguageSelector);
  Muya.use(ParagraphFrontButton);
  Muya.use(ParagraphFrontMenu);
  Muya.use(ParagraphQuickInsertMenu);
  Muya.use(PreviewToolBar);
  Muya.use(TableColumnToolbar);
  Muya.use(TableDragBar);
  Muya.use(TableRowColumMenu);
  Muya.use(ImageToolBar);
  Muya.use(ImageResizeBar);
  Muya.use(FootnoteTool);
  Muya.use(LinkTools, {
    jumpClick: (info: { href?: string } | null) => {
      if (info?.href) markdownLinkHandler?.(info.href);
    },
  });
  pluginsRegistered = true;
}

function scrollToHeading(root: HTMLElement, hash: string): boolean {
  let target = hash.replace(/^#/, "");
  try {
    target = decodeURIComponent(target);
  } catch {
    // Keep the original fragment when decoding fails.
  }
  if (!target) return false;

  const heading = Array.from(
    root.querySelectorAll<HTMLElement>(".mu-atx-heading, .mu-setext-heading"),
  ).find((element) => (
    element.id === target
    || slugifyMarkdownHeading(element.textContent ?? "") === target
  ));
  if (!heading) return false;
  heading.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

async function prepareMarkdownSource(
  source: string,
  currentPath: string,
  cache: Map<string, string>,
): Promise<PreparedMarkdown> {
  const fenceRanges = markdownFenceRanges(source);
  const sources = Array.from(source.matchAll(MARKDOWN_IMAGE_SOURCE_PATTERN))
    .filter((match) => !isInsideMarkdownCode(source, match.index ?? 0, fenceRanges))
    .map((match) => match[2])
    .filter((value) => (
      value
      && !/^(?:https?:|data:|blob:|#|\/|[A-Za-z]:[\\/]|\\\\)/i.test(value)
    ));
  if (sources.length === 0) {
    return { markdown: source, restore: (value) => value };
  }

  const replacements = new Map<string, string>();
  await Promise.all(Array.from(new Set(sources)).map(async (imageSource) => {
    const wrapped = imageSource.startsWith("<") && imageSource.endsWith(">");
    let assetPath = wrapped ? imageSource.slice(1, -1) : imageSource;
    try {
      assetPath = decodeURIComponent(assetPath);
    } catch {
      // Keep the original path when a malformed escape sequence is present.
    }
    assetPath = assetPath.split(/[?#]/, 1)[0];
    if (!assetPath) return;
    const cacheKey = `${currentPath}\0${assetPath}`;
    try {
      let dataUrl = cache.get(cacheKey);
      if (!dataUrl) {
        dataUrl = await loadMarkdownAsset(currentPath, assetPath);
        if (dataUrl) cache.set(cacheKey, dataUrl);
      }
      if (dataUrl) replacements.set(imageSource, dataUrl);
    } catch {
      // Keep the original relative path so Muya can display its load-failure UI.
    }
  }));

  if (replacements.size === 0) {
    return { markdown: source, restore: (value) => value };
  }
  let imageIndex = 0;
  const restoreMap = new Map<string, string>();
  const markdown = source.replace(
    MARKDOWN_IMAGE_SOURCE_PATTERN,
    (full, prefix: string, imageSource: string, offset: number) => {
      if (isInsideMarkdownCode(source, offset, fenceRanges)) return full;
      const dataUrl = replacements.get(imageSource);
      if (!dataUrl) return full;
      const uniqueDataUrl = dataUrl.replace(
        /^(data:image\/[^;,]+)/i,
        `$1;x-viewer-id=${imageIndex}`,
      );
      imageIndex += 1;
      restoreMap.set(uniqueDataUrl, imageSource);
      return `${prefix}${uniqueDataUrl}`;
    },
  );
  return {
    markdown,
    restore: (value) => {
      let restored = value;
      for (const [dataUrl, original] of restoreMap) {
        restored = restored.split(dataUrl).join(original);
      }
      return restored;
    },
  };
}

async function hydrateImages(
  root: HTMLElement,
  currentPath: string,
  cache: Map<string, string>,
): Promise<void> {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img[src]"));
  await Promise.all(images.map(async (image) => {
    const source = image.getAttribute("src")?.trim();
    if (
      !source
      || source.startsWith("data:")
      || source.startsWith("blob:")
      || isExternalMarkdownUrl(source)
      || image.dataset.markdownAssetState
    ) {
      return;
    }

    let assetPath = source;
    try {
      assetPath = decodeURIComponent(source);
    } catch {
      // Keep the original path when a malformed escape sequence is present.
    }
    if (/^(?:[A-Za-z]:[\\/]|[\\/]{2}|\\)/.test(assetPath)) {
      image.dataset.markdownAssetState = "blocked";
      image.title = "只允许加载当前 Markdown 文件目录内的相对图片";
      return;
    }
    assetPath = assetPath.split(/[?#]/, 1)[0];

    image.dataset.markdownAssetState = "loading";
    try {
      const cacheKey = `${currentPath}\0${assetPath}`;
      let dataUrl = cache.get(cacheKey);
      if (!dataUrl) {
        dataUrl = await loadMarkdownAsset(currentPath, assetPath);
        if (dataUrl) cache.set(cacheKey, dataUrl);
      }
      if (!image.isConnected) return;
      if (!dataUrl) {
        image.dataset.markdownAssetState = "unavailable";
        return;
      }
      image.src = dataUrl;
      image.dataset.markdownAssetState = "loaded";
    } catch {
      image.dataset.markdownAssetState = "error";
      image.title = image.alt ? `图片加载失败：${image.alt}` : "图片加载失败";
    }
  }));
}

function clearHtmlFormattingAroundSelection(
  block: { text: string; setCursor: (start: number, end: number, focus?: boolean) => void },
  selectedText: string,
  hintStart: number,
): boolean {
  let start = block.text.indexOf(selectedText, Math.max(0, hintStart - 32));
  if (start < 0) start = block.text.indexOf(selectedText);
  if (start < 0) return false;

  let before = block.text.slice(0, start);
  let after = block.text.slice(start + selectedText.length);
  const openingTag = /[ \t]*<(?:u|mark|span|strong|b|em|i|del|s|sub|sup)\b[^>]*>[ \t]*$/i;
  const closingTag = /^[ \t]*<\/(?:u|mark|span|strong|b|em|i|del|s|sub|sup)>[ \t]*/i;
  let changed = false;
  for (;;) {
    const nextBefore = before.replace(openingTag, "");
    const nextAfter = after.replace(closingTag, "");
    const openingMarker = nextBefore.match(/(\*\*|__|~~|`|_|\*)[ \t]*$/)?.[1];
    const closingMarker = nextAfter.match(/^[ \t]*(\*\*|__|~~|`|_|\*)/)?.[1];
    const withoutMarkers = openingMarker && closingMarker
      ? {
        before: nextBefore.slice(0, nextBefore.lastIndexOf(openingMarker)),
        after: nextAfter.slice(nextAfter.indexOf(closingMarker) + closingMarker.length),
      }
      : { before: nextBefore, after: nextAfter };
    if (
      withoutMarkers.before === before
      && withoutMarkers.after === after
    ) {
      break;
    }
    before = withoutMarkers.before;
    after = withoutMarkers.after;
    changed = true;
  }
  if (!changed) return false;

  const nextText = `${before}${selectedText}${after}`;
  block.text = nextText;
  const nextStart = before.length;
  block.setCursor(nextStart, nextStart + selectedText.length, true);
  return true;
}

function wrapSelectedTextWithStyle(
  selected: string,
  declarations: Record<string, string>,
): string | null {
  let prefix = "";
  let suffix = "";
  let inner = selected;
  for (const marker of ["***", "___", "**", "__", "~~", "*", "_"]) {
    if (
      inner.startsWith(marker)
      && inner.endsWith(marker)
      && inner.length > marker.length * 2
    ) {
      prefix = marker;
      suffix = marker;
      inner = inner.slice(marker.length, -marker.length);
      break;
    }
  }

  if (/[`*_~]/.test(inner)) return null;
  const style = Object.entries(declarations)
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ");
  const styled = `<span style="${style}">${inner}</span>`;
  if (prefix) return `${prefix}${styled}${suffix}`;

  const htmlPair = /^<(strong|b|em|i|u|mark|del|s|sub|sup)(\s[^>]*)?>([\s\S]*)<\/\1>$/i.exec(selected);
  if (htmlPair) {
    return `<${htmlPair[1]}${htmlPair[2] ?? ""}><span style="${style}">${htmlPair[3]}</span></${htmlPair[1]}>`;
  }
  const existingSpan = /^<span\b([^>]*)>([\s\S]*)<\/span>$/i.exec(selected);
  if (existingSpan) {
    const existingStyle = /\sstyle=(?:"([^"]*)"|'([^']*)')/i.exec(existingSpan[1]);
    const attrs = existingSpan[1].replace(/\sstyle=(?:"[^"]*"|'[^']*')/i, "");
    const mergedStyle = [
      existingStyle?.[1] ?? existingStyle?.[2] ?? "",
      style,
    ].filter(Boolean).join("; ").replace(/"/g, "&quot;");
    return `<span${attrs} style="${mergedStyle}">${existingSpan[2]}</span>`;
  }
  return styled;
}

function applyInlineStyleToSelection(
  editor: Muya,
  declarations: Record<string, string>,
  fallback: MuyaSelection | null,
): boolean {
  const current = editor.editor.selection.getSelection();
  const selection = current && !current.isCollapsed ? current : fallback;
  if (
    !selection
    || selection.isCollapsed
    || !selection.isSelectionInSameBlock
  ) {
    return false;
  }

  const block = selection.anchorBlock;
  const start = Math.min(selection.anchor.offset, selection.focus.offset);
  const end = Math.max(selection.anchor.offset, selection.focus.offset);
  if (start === end || start < 0 || end > block.text.length) return false;

  const selected = block.text.slice(start, end);
  const before = block.text.slice(0, start);
  const after = block.text.slice(end);
  const openingSpan = /(<span\b[^>]*>)[ \t]*$/.exec(before);
  const closingSpan = /^[ \t]*<\/span>/.exec(after);
  if (openingSpan && closingSpan) {
    const attrs = /^<span\b([^>]*)>$/.exec(openingSpan[1])?.[1] ?? "";
    const existingStyle = /\sstyle=(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const attrsWithoutStyle = attrs.replace(/\sstyle=(?:"[^"]*"|'[^']*')/i, "");
    const style = [
      existingStyle?.[1] ?? existingStyle?.[2] ?? "",
      ...Object.entries(declarations).map(([property, value]) => `${property}: ${value}`),
    ].filter(Boolean).join("; ").replace(/"/g, "&quot;");
    const replacement = `<span${attrsWithoutStyle} style="${style}">${selected}</span>`;
    const nextStart = start - openingSpan[0].length;
    block.text = `${block.text.slice(0, nextStart)}${replacement}${block.text.slice(end + closingSpan[0].length)}`;
    const selectedStart = nextStart + replacement.indexOf(selected);
    block.setCursor(selectedStart, selectedStart + selected.length, true);
    return true;
  }

  const replacement = wrapSelectedTextWithStyle(selected, declarations);
  if (!replacement) return false;
  block.text = `${block.text.slice(0, start)}${replacement}${block.text.slice(end)}`;
  const selectedStart = replacement.indexOf(selected);
  const selectionStart = start + (selectedStart >= 0 ? selectedStart : 0);
  block.setCursor(selectionStart, selectionStart + selected.length, true);
  return true;
}

export function MuyaMarkdownEditor({
  source,
  currentPath,
  settings,
  onChange,
  onOpenLocalPath,
}: MuyaMarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Muya | null>(null);
  const lastMarkdownRef = useRef(source);
  const sourceRef = useRef(source);
  const lastPreparedPathRef = useRef(currentPath);
  const sourceRevisionRef = useRef(0);
  const restoreMarkdownRef = useRef<(value: string) => string>((value) => value);
  const onChangeRef = useRef(onChange);
  const currentPathRef = useRef(currentPath);
  const openLocalPathRef = useRef(onOpenLocalPath);
  const imageCacheRef = useRef(new Map<string, string>());
  const imageHydrationFrameRef = useRef<number | null>(null);
  const selectionSnapshotRef = useRef<MuyaSelection | null>(null);
  sourceRef.current = source;
  onChangeRef.current = onChange;
  currentPathRef.current = currentPath;
  openLocalPathRef.current = onOpenLocalPath;

  const scheduleImageHydration = () => {
    if (imageHydrationFrameRef.current !== null) return;
    imageHydrationFrameRef.current = window.requestAnimationFrame(() => {
      imageHydrationFrameRef.current = null;
      if (!hostRef.current) return;
      void hydrateImages(hostRef.current, currentPathRef.current, imageCacheRef.current);
    });
  };

  useEffect(() => {
    if (!hostRef.current) return;
    registerMuyaPlugins();
    const mount = document.createElement("div");
    mount.className = "muya-editor-mount";
    hostRef.current.replaceChildren(mount);
    let cancelled = false;
    let editor: Muya | null = null;
    let imageObserver: MutationObserver | null = null;
    let pendingFormatSelection: {
      block: { text: string; setCursor: (start: number, end: number, focus?: boolean) => void };
      start: number;
      text: string;
      clear: boolean;
    } | null = null;
    const rememberFormatSelection = (event: Event) => {
      const target = event.target;
      if (
        !editor
        || !(target instanceof Element)
        || !target.closest(".mu-format-picker")
      ) {
        pendingFormatSelection = null;
        return;
      }
      const selection = editor.editor.selection.getSelection();
      selectionSnapshotRef.current = selection && !selection.isCollapsed ? selection : null;
      const formatItem = target.closest(".mu-format-picker li.item");
      if (
        !formatItem
        || !selection
        || selection.isCollapsed
        || !selection.isSelectionInSameBlock
      ) {
        pendingFormatSelection = null;
        return;
      }
      const block = selection.anchorBlock;
      const start = Math.min(selection.anchor.offset, selection.focus.offset);
      const end = Math.max(selection.anchor.offset, selection.focus.offset);
      const selectedText = block.text.slice(start, end);
      pendingFormatSelection = selectedText
        ? {
          block,
          start,
          text: selectedText,
          clear: Boolean(formatItem.classList.contains("clear")),
        }
        : null;
    };
    const preserveSelectionAfterFormat = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".mu-format-picker li.item")) return;
      const pending = pendingFormatSelection;
      pendingFormatSelection = null;
      if (!pending) return;
      window.requestAnimationFrame(() => {
        if (pending.clear && clearHtmlFormattingAroundSelection(
          pending.block,
          pending.text,
          pending.start,
        )) {
          return;
        }
        let nextStart = pending.block.text.indexOf(pending.text, Math.max(0, pending.start - 32));
        if (nextStart < 0) nextStart = pending.block.text.indexOf(pending.text);
        if (nextStart >= 0) {
          pending.block.setCursor(nextStart, nextStart + pending.text.length, true);
        }
        window.requestAnimationFrame(decorateFormatToolbar);
      });
    };
    const createColorControl = (
      list: HTMLUListElement,
      className: string,
      title: string,
      iconText: string,
      property: "color" | "background-color",
      initialValue: string,
    ) => {
      const item = document.createElement("li");
      item.className = `item mu-viewer-color-item ${className}`;
      item.title = title;
      const control = document.createElement("label");
      control.className = "mu-viewer-color-control";
      const icon = document.createElement("span");
      icon.className = "mu-viewer-color-icon";
      icon.textContent = iconText;
      const input = document.createElement("input");
      input.type = "color";
      input.value = initialValue;
      input.title = title;
      input.setAttribute("aria-label", title);
      const updateIcon = () => {
        if (property === "color") icon.style.borderBottomColor = input.value;
        else icon.style.color = input.value;
      };
      updateIcon();
      input.addEventListener("input", updateIcon);
      input.addEventListener("change", () => {
        if (!editor) return;
        applyInlineStyleToSelection(
          editor,
          { [property]: input.value },
          selectionSnapshotRef.current,
        );
      });
      control.append(icon, input);
      item.appendChild(control);
      list.appendChild(item);
    };
    const decorateFormatToolbar = () => {
      if (!editor) return;
      const picker = Array.from(
        document.querySelectorAll<HTMLElement>(".mu-format-picker"),
      ).find((element) => element.querySelector("ul"));
      if (!picker) return;
      const list = picker.querySelector<HTMLUListElement>("ul");
      if (!list) return;
      picker.classList.add("mu-viewer-has-color-tools");
      if (!list.querySelector(".mu-viewer-color-item")) {
        createColorControl(
          list,
          "mu-viewer-text-color",
          "文字颜色",
          "A",
          "color",
          "#d32f2f",
        );
        createColorControl(
          list,
          "mu-viewer-background-color",
          "文字背景颜色",
          "▰",
          "background-color",
          "#fff176",
        );
      }
    };

    void (async () => {
      const initialSource = sourceRef.current;
      const initialPath = currentPathRef.current;
      const prepared = await prepareMarkdownSource(
        initialSource,
        initialPath,
        imageCacheRef.current,
      );
      if (cancelled || !hostRef.current) return;

      editor = new Muya(mount, {
        markdown: prepared.markdown,
        fontSize: settings.fontSize,
        lineHeight: settings.lineHeight,
        codeBlockLineNumbers: true,
        footnote: true,
        math: true,
        frontMatter: true,
        spellcheckEnabled: true,
        hideQuickInsertHint: false,
        hideLinkPopup: false,
        disableHtml: false,
      });
      restoreMarkdownRef.current = prepared.restore;
      lastMarkdownRef.current = initialSource;
      lastPreparedPathRef.current = initialPath;
      editor.locale(zh);
      editor.on("muya-format-picker", () => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(decorateFormatToolbar);
        });
      });
      editor.on("json-change", () => {
        if (!editor) return;
        const next = restoreMarkdownRef.current(editor.getMarkdown());
        lastMarkdownRef.current = next;
        onChangeRef.current(next);
        scheduleImageHydration();
      });
      editor.init();
      editorRef.current = editor;
      scheduleImageHydration();
      imageObserver = new MutationObserver(scheduleImageHydration);
      imageObserver.observe(mount, { childList: true, subtree: true });
      document.addEventListener("pointerdown", rememberFormatSelection, true);
      document.addEventListener("click", preserveSelectionAfterFormat, true);

      if (sourceRef.current !== initialSource || currentPathRef.current !== initialPath) {
        const revision = ++sourceRevisionRef.current;
        const nextSource = sourceRef.current;
        const nextPath = currentPathRef.current;
        const nextPrepared = await prepareMarkdownSource(
          nextSource,
          nextPath,
          imageCacheRef.current,
        );
        if (
          !cancelled
          && editor === editorRef.current
          && revision === sourceRevisionRef.current
        ) {
          restoreMarkdownRef.current = nextPrepared.restore;
          lastMarkdownRef.current = nextSource;
          lastPreparedPathRef.current = nextPath;
          editor.setContent(nextPrepared.markdown);
          scheduleImageHydration();
        }
      }
    })();

    return () => {
      cancelled = true;
      document.removeEventListener("pointerdown", rememberFormatSelection, true);
      document.removeEventListener("click", preserveSelectionAfterFormat, true);
      imageObserver?.disconnect();
      if (imageHydrationFrameRef.current !== null) {
        window.cancelAnimationFrame(imageHydrationFrameRef.current);
        imageHydrationFrameRef.current = null;
      }
      editor?.destroy();
      mount.remove();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (
      !editor
      || (
        source === lastMarkdownRef.current
        && currentPath === lastPreparedPathRef.current
      )
    ) {
      return;
    }
    const revision = ++sourceRevisionRef.current;
    if (currentPath !== lastPreparedPathRef.current) imageCacheRef.current.clear();
    lastMarkdownRef.current = source;
    selectionSnapshotRef.current = null;
    void prepareMarkdownSource(source, currentPath, imageCacheRef.current).then((prepared) => {
      if (
        revision !== sourceRevisionRef.current
        || editor !== editorRef.current
      ) {
        return;
      }
      restoreMarkdownRef.current = prepared.restore;
      lastPreparedPathRef.current = currentPath;
      editor.setContent(prepared.markdown);
      scheduleImageHydration();
    });
  }, [currentPath, source]);

  useEffect(() => {
    if (currentPath !== lastPreparedPathRef.current) imageCacheRef.current.clear();
    scheduleImageHydration();
  }, [currentPath]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.options.fontSize = settings.fontSize;
    editor.options.lineHeight = settings.lineHeight;
  }, [settings.fontSize, settings.lineHeight]);

  useEffect(() => {
    markdownLinkHandler = (href: string) => {
      const value = href.trim();
      if (!value) return;
      if (value.startsWith("#")) {
        if (hostRef.current) scrollToHeading(hostRef.current, value);
        return;
      }
      if (isExternalMarkdownUrl(value)) {
        if (isSafeMarkdownUrl(value)) void openExternalUrl(value);
        return;
      }
      const localPath = resolveMarkdownLocalPath(currentPathRef.current, value);
      if (localPath) openLocalPathRef.current?.(localPath);
    };
    return () => {
      markdownLinkHandler = null;
    };
  }, []);

  const editorStyle = {
    ...markdownSettingsVars(settings),
    "--editor-color": settings.textColor,
    "--editor-color-80": settings.headingColor,
    "--editor-color-50": settings.textColor,
    "--editor-color-30": `color-mix(in srgb, ${settings.textColor} 30%, transparent)`,
    "--editor-color-10": `color-mix(in srgb, ${settings.textColor} 10%, transparent)`,
    "--editor-color-04": `color-mix(in srgb, ${settings.textColor} 4%, transparent)`,
    "--editor-bg-color": settings.backgroundColor,
    "--code-block-bg-color": settings.codeBackground,
    "--theme-color": settings.linkColor,
  } as CSSProperties;

  return (
    <div
      className={`muya-markdown-shell markdown-theme-${settings.theme} markdown-heading-${settings.headingStyle} markdown-table-${settings.tableStyle}`}
      data-testid="muya-markdown-editor"
      style={editorStyle}
    >
      <div ref={hostRef} className="muya-markdown-host" />
    </div>
  );
}
