import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { CSSProperties } from "react";
import DOMPurify from "dompurify";
import { loadMarkdownAsset } from "../lib/api";
import {
  MarkdownSelectionToolbar,
  type MarkdownLocalStyle,
} from "./MarkdownSelectionToolbar";
import type { MarkdownReadingSettings } from "../lib/markdown-settings";
import { markdownSettingsVars } from "../lib/markdown-settings";
import {
  isExternalMarkdownUrl,
  isSafeMarkdownUrl,
  parseMarkdown,
  resolveMarkdownLocalPath,
} from "../lib/markdown";
import "../markdown.css";

export interface MarkdownViewProps {
  source: string;
  currentPath: string;
  onOpenLocalPath?: (path: string) => void;
  onLocalStyleChange?: (source: string) => void;
  onLocalStyleError?: (message: string) => void;
  settings: MarkdownReadingSettings;
}

const ALLOWED_INLINE_STYLES = new Set([
  "background-color",
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "margin-left",
  "text-align",
  "text-decoration",
  "text-decoration-line",
]);

function sanitizeInlineStyles(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("[style]").forEach((element) => {
    const style = element.style;
    for (let index = style.length - 1; index >= 0; index -= 1) {
      const property = style.item(index);
      const value = style.getPropertyValue(property).trim();
      if (
        !ALLOWED_INLINE_STYLES.has(property)
        || /(?:url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:)/i.test(value)
      ) {
        style.removeProperty(property);
      }
    }
    if (!style.cssText.trim()) element.removeAttribute("style");
  });
}

function safeExternalUrl(url: string): string | null {
  const value = url.trim();
  if (value.startsWith("//")) return isSafeMarkdownUrl(`https:${value}`) ? `https:${value}` : null;
  return isSafeMarkdownUrl(value) && isExternalMarkdownUrl(value) ? value : null;
}

async function openExternalLink(url: string): Promise<void> {
  const externalUrl = safeExternalUrl(url);
  if (!externalUrl) return;

  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const opener = await import("@tauri-apps/plugin-opener");
      await opener.openUrl(externalUrl);
      return;
    } catch {
      // Fall through to the browser implementation when the native opener is unavailable.
    }
  }

  window.open(externalUrl, "_blank", "noopener,noreferrer");
}

function sanitizeMarkdownHtml(html: string): string {
  const sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "meta", "link", "base"],
    FORBID_ATTR: ["srcset"],
  });
  const template = document.createElement("template");
  template.innerHTML = sanitized;
  sanitizeInlineStyles(template.content);

  template.content.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((link) => {
    const href = link.getAttribute("href") ?? "";
    if (!isSafeMarkdownUrl(href)) {
      link.removeAttribute("href");
      return;
    }
    link.setAttribute("rel", "noopener noreferrer");
  });

  template.content.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    const source = image.getAttribute("src") ?? "";
    if (!source || !isSafeMarkdownUrl(source)) image.removeAttribute("src");
    image.setAttribute("loading", "lazy");
    image.setAttribute("decoding", "async");
  });

  template.content.querySelectorAll<HTMLInputElement>("input[type='checkbox']").forEach((checkbox) => {
    checkbox.disabled = true;
  });

  template.content.querySelectorAll<HTMLTableElement>("table").forEach((table) => {
    const wrapper = document.createElement("div");
    wrapper.className = "markdown-table-scroll";
    table.parentNode?.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });

  return template.innerHTML;
}

function scrollToHeading(container: HTMLElement, hash: string): boolean {
  let id = hash.replace(/^#/, "");
  try {
    id = decodeURIComponent(id);
  } catch {
    // Use the raw fragment when decoding fails.
  }
  if (!id) return false;

  const target = Array.from(container.querySelectorAll<HTMLElement>("[id]")).find(
    (element) => element.id === id,
  );
  if (!target) return false;

  target.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function localStyleHtml(text: string, style: MarkdownLocalStyle): string {
  const declarations: string[] = [];
  if (style.fontSize) declarations.push(`font-size: ${style.fontSize}`);
  if (style.fontFamily) {
    const family = {
      system: '"Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif',
      serif: 'Georgia, "Noto Serif SC", "Songti SC", serif',
      mono: '"Cascadia Code", Consolas, monospace',
    }[style.fontFamily] ?? style.fontFamily;
    declarations.push(`font-family: ${family}`);
  }
  if (style.color) declarations.push(`color: ${style.color}`);
  if (style.backgroundColor) declarations.push(`background-color: ${style.backgroundColor}`);
  if (style.bold !== undefined) {
    declarations.push(`font-weight: ${style.bold ? "700" : "400"}`);
  }
  if (style.italic !== undefined) {
    declarations.push(`font-style: ${style.italic ? "italic" : "normal"}`);
  }
  if (style.underline !== undefined) {
    declarations.push(`text-decoration: ${style.underline ? "underline" : "none"}`);
  }
  const styleAttribute = declarations.length > 0
    ? ` style="${escapeHtml(declarations.join("; "))}"`
    : "";
  return `<span${styleAttribute}>${escapeHtml(text)}</span>`;
}

function toHexColor(value: string, fallback: string): string {
  const match = value.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (!match) return fallback;
  return `#${[match[1], match[2], match[3]]
    .map((part) => Number(part).toString(16).padStart(2, "0"))
    .join("")}`;
}

function currentSelectionStyle(range: Range): MarkdownLocalStyle {
  const node = range.commonAncestorContainer;
  const element = node instanceof Element ? node : node.parentElement;
  if (!element) return {};
  const style = getComputedStyle(element);
  const weight = Number.parseInt(style.fontWeight, 10);
  const family = style.fontFamily.toLocaleLowerCase();
  return {
    fontSize: style.fontSize,
    fontFamily: family.includes("cascadia") || family.includes("consolas") || family.includes("mono")
      ? "mono"
      : family.includes("georgia") || family.includes("songti") || family.includes("serif")
        ? "serif"
        : "system",
    color: toHexColor(style.color, "#20384e"),
    backgroundColor: toHexColor(style.backgroundColor, "#fff0a8"),
    bold: !Number.isNaN(weight) ? weight >= 600 : style.fontWeight === "bold",
    italic: style.fontStyle === "italic" || style.fontStyle === "oblique",
    underline:
      style.textDecorationLine.includes("underline")
      || style.textDecoration.includes("underline"),
  };
}

export function MarkdownView({
  source,
  currentPath,
  onOpenLocalPath,
  onLocalStyleChange,
  onLocalStyleError,
  settings,
}: MarkdownViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<Range | null>(null);
  const [selection, setSelection] = useState<{
    rect: DOMRect;
    text: string;
    style: MarkdownLocalStyle;
  } | null>(null);
  const rendered = useMemo(() => parseMarkdown(source), [source]);
  const sanitizedHtml = useMemo(() => sanitizeMarkdownHtml(rendered.html), [rendered.html]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = 0;
  }, [currentPath]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let cancelled = false;
    const images = Array.from(container.querySelectorAll<HTMLImageElement>("img[src]"));

    for (const image of images) {
      const source = image.getAttribute("src")?.trim();
      if (!source || isExternalMarkdownUrl(source) || source.startsWith("data:")) continue;
      let assetPath = source;
      try {
        assetPath = decodeURIComponent(source);
      } catch {
        // Keep the original path when a malformed escape sequence is present.
      }
      if (/^(?:[A-Za-z]:[\\/]|[\\/]{2}|\\)/.test(assetPath)) {
        image.classList.add("markdown-image-error");
        image.title = "只允许加载当前 Markdown 文件目录内的相对图片";
        continue;
      }
      void loadMarkdownAsset(currentPath, assetPath).then((dataUrl) => {
        if (cancelled || !dataUrl) return;
        image.src = dataUrl;
      }).catch(() => {
        if (cancelled) return;
        image.classList.add("markdown-image-error");
        image.title = image.alt ? `图片加载失败：${image.alt}` : "图片加载失败";
      });
    }

    return () => {
      cancelled = true;
    };
  }, [currentPath, sanitizedHtml]);

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (!link || !scrollRef.current?.contains(link)) return;

    const href = link.getAttribute("href")?.trim();
    if (!href) return;
    event.preventDefault();

    if (href.startsWith("#")) {
      scrollToHeading(scrollRef.current, href);
      return;
    }

    if (isExternalMarkdownUrl(href)) {
      void openExternalLink(href);
      return;
    }

    const localPath = resolveMarkdownLocalPath(currentPath, href);
    if (localPath) onOpenLocalPath?.(localPath);
  };

  const captureSelection = () => {
    const container = scrollRef.current;
    const selected = window.getSelection();
    if (!container || !selected || selected.rangeCount === 0) {
      selectionRef.current = null;
      setSelection(null);
      return;
    }
    const range = selected.getRangeAt(0);
    const text = selected.toString().trim();
    if (
      range.collapsed
      || !text
      || !container.contains(range.commonAncestorContainer)
    ) {
      selectionRef.current = null;
      setSelection(null);
      return;
    }
    selectionRef.current = range.cloneRange();
    setSelection({
      rect: range.getBoundingClientRect(),
      text,
      style: currentSelectionStyle(range),
    });
  };

  const applyLocalStyle = (style: MarkdownLocalStyle) => {
    const selected = selectionRef.current;
    const text = selected?.toString().trim() ?? "";
    if (!text || !onLocalStyleChange) return;
    const first = source.indexOf(text);
    if (first < 0 || source.indexOf(text, first + text.length) >= 0) {
      onLocalStyleError?.("当前选区不是唯一的纯文本片段，请只选择同一段落内的一段文字");
      return;
    }
    let start = first;
    let end = first + text.length;
    const unwrap = (opening: string, closing: string) => {
      if (
        source.slice(0, start).endsWith(opening)
        && source.slice(end).startsWith(closing)
      ) {
        start -= opening.length;
        end += closing.length;
      }
    };

    if (style.bold === false) {
      unwrap("**", "**");
      unwrap("__", "__");
      unwrap("<strong>", "</strong>");
      unwrap("<b>", "</b>");
    }
    if (style.italic === false) {
      const before = source.slice(0, start);
      const after = source.slice(end);
      if (!before.endsWith("**") && before.endsWith("*") && after.startsWith("*") && !after.startsWith("**")) {
        start -= 1;
        end += 1;
      } else if (!before.endsWith("__") && before.endsWith("_") && after.startsWith("_") && !after.startsWith("__")) {
        start -= 1;
        end += 1;
      }
      unwrap("<em>", "</em>");
      unwrap("<i>", "</i>");
    }
    if (style.underline === false) {
      unwrap("<u>", "</u>");
    }

    const nextSource = `${source.slice(0, start)}${localStyleHtml(text, style)}${source.slice(end)}`;
    onLocalStyleChange(nextSource);
    selectionRef.current = null;
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div
      className={`markdown-view markdown-theme-${settings.theme} markdown-heading-${settings.headingStyle} markdown-table-${settings.tableStyle}`}
      data-testid="markdown-view"
      style={markdownSettingsVars(settings) as CSSProperties}
    >
      <div
        ref={scrollRef}
        className="markdown-view-scroll"
        onMouseUp={captureSelection}
        onKeyUp={captureSelection}
      >
        <article
          className="markdown-body"
          onClick={handleClick}
          dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        />
      </div>
      {selection && (
        <MarkdownSelectionToolbar
          key={`${selection.text}:${selection.rect.left}:${selection.rect.top}`}
          rect={selection.rect}
          initialStyle={selection.style}
          onApply={applyLocalStyle}
          onClose={() => {
            selectionRef.current = null;
            setSelection(null);
          }}
        />
      )}
    </div>
  );
}
