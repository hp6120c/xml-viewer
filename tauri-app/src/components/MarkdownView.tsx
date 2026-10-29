import { useEffect, useMemo, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import DOMPurify from "dompurify";
import { loadMarkdownAsset } from "../lib/api";
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
    FORBID_ATTR: ["style", "srcset"],
  });
  const template = document.createElement("template");
  template.innerHTML = sanitized;

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

export function MarkdownView({ source, currentPath, onOpenLocalPath }: MarkdownViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
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

  return (
    <div className="markdown-view" data-testid="markdown-view">
      <div ref={scrollRef} className="markdown-view-scroll">
        <article
          className="markdown-body"
          onClick={handleClick}
          dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        />
      </div>
    </div>
  );
}
