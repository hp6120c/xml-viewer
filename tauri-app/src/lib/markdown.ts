import MarkdownIt from "markdown-it";
import type { Token } from "markdown-it";
import anchor from "markdown-it-anchor";
import footnote from "markdown-it-footnote";
// @ts-expect-error markdown-it-task-lists does not publish TypeScript declarations
import taskLists from "markdown-it-task-lists";
// @ts-expect-error markdown-it-emoji does not publish TypeScript declarations
import { full as emoji } from "markdown-it-emoji";
import hljs from "highlight.js/lib/common";
import { parse as parseYaml } from "yaml";

export interface MarkdownHeading {
  level: number;
  text: string;
  id: string;
}

export interface MarkdownStats {
  headingCount: number;
  wordCount: number;
  readingMinutes: number;
}

export interface MarkdownFrontMatter {
  data: Record<string, unknown>;
  raw: string;
  error: string | null;
}

export interface ParsedMarkdown {
  body: string;
  html: string;
  headings: MarkdownHeading[];
  stats: MarkdownStats;
  frontMatter: MarkdownFrontMatter;
}

const FRONT_MATTER_PATTERN = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const EXTERNAL_PROTOCOL_PATTERN = /^(?:https?:|mailto:)/i;
const BLOCKED_PROTOCOL_PATTERN = /^(?:javascript|vbscript|data|file|blob):/i;
const WORD_CHARACTER_PATTERN = /[A-Za-z0-9\u00C0-\u024F\u0370-\u052F\u1E00-\u1EFF]+(?:['’-][A-Za-z0-9\u00C0-\u024F\u0370-\u052F\u1E00-\u1EFF]+)*/g;
const CJK_CHARACTER_PATTERN = /[\u2E80-\u2FFF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/g;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function headingText(token: Token): string {
  if (!token.children?.length) return token.content.trim();

  return token.children
    .map((child) => {
      if (child.type === "text" || child.type === "code_inline" || child.type === "emoji") {
        return child.content;
      }
      if (child.type === "image") return child.content;
      return "";
    })
    .join("")
    .trim();
}

export function slugifyMarkdownHeading(value: string): string {
  const slug = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "section";
}

export function parseMarkdownFrontMatter(source: string): {
  body: string;
  frontMatter: MarkdownFrontMatter;
} {
  const match = FRONT_MATTER_PATTERN.exec(source);
  if (!match) {
    return {
      body: source,
      frontMatter: { data: {}, raw: "", error: null },
    };
  }

  const raw = match[1] ?? "";
  try {
    const parsed = parseYaml(raw);
    const data = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
    return {
      body: source.slice(match[0].length),
      frontMatter: { data, raw, error: null },
    };
  } catch (error) {
    return {
      body: source.slice(match[0].length),
      frontMatter: {
        data: {},
        raw,
        error: error instanceof Error ? error.message : "YAML front matter 解析失败",
      },
    };
  }
}

export function isSafeMarkdownUrl(url: string): boolean {
  const value = url.trim();
  if (!value) return true;
  if (BLOCKED_PROTOCOL_PATTERN.test(value)) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    return EXTERNAL_PROTOCOL_PATTERN.test(value);
  }
  return true;
}

export function isExternalMarkdownUrl(url: string): boolean {
  const value = url.trim();
  return EXTERNAL_PROTOCOL_PATTERN.test(value) || value.startsWith("//");
}

function normalizeWindowsPath(path: string): string {
  const normalized = path.replace(/\//g, "\\");
  const driveMatch = /^([A-Za-z]:)(.*)$/.exec(normalized);
  const uncPrefix = normalized.startsWith("\\\\") ? "\\\\" : "";
  const prefix = driveMatch ? `${driveMatch[1]}\\` : uncPrefix;
  const rest = driveMatch
    ? driveMatch[2].replace(/^\\+/, "")
    : uncPrefix
      ? normalized.slice(2)
      : normalized.replace(/^\\+/, "");
  const parts: string[] = [];

  for (const part of rest.split("\\")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
      else if (!prefix) parts.push(part);
      continue;
    }
    parts.push(part);
  }

  const joined = parts.join("\\");
  if (prefix === "\\\\") return `\\\\${joined}`;
  return prefix ? `${prefix}${joined}` : joined;
}

export function resolveMarkdownLocalPath(currentPath: string, href: string): string | null {
  if (!currentPath || !href || href.startsWith("#")) return null;

  const pathEnd = href.search(/[?#]/);
  let linkPath = pathEnd >= 0 ? href.slice(0, pathEnd) : href;
  if (!linkPath) return null;

  try {
    linkPath = decodeURIComponent(linkPath);
  } catch {
    // Keep the original path when a malformed escape sequence is present.
  }

  if (!/\.(?:md|markdown)$/i.test(linkPath)) return null;

  const separator = currentPath.includes("\\") ? "\\" : "/";
  const baseDirectory = currentPath.replace(/[\\/][^\\/]*$/, "");

  // Only follow relative Markdown links inside the current document tree.
  // Absolute, UNC and device paths could trigger unintended local/network access.
  if (
    /^[A-Za-z]:[\\/]/.test(linkPath)
    || /^[\\/]{2}/.test(linkPath)
    || linkPath.startsWith("\\")
    || linkPath.startsWith("/")
  ) {
    return null;
  }

  const joined = `${baseDirectory}${separator}${linkPath.replace(/^[\\/]+/, "")}`;
  const normalized = separator === "\\" ? normalizeWindowsPath(joined) : joined;
  if (separator === "\\") {
    const base = normalizeWindowsPath(baseDirectory).toLocaleLowerCase();
    const candidate = normalized.toLocaleLowerCase();
    if (candidate !== base && !candidate.startsWith(`${base}\\`)) return null;
  } else if (!normalized.startsWith(`${baseDirectory}/`)) {
    return null;
  }
  return normalized;
}

export function renderMarkdownHtml(source: string): string {
  const { body } = parseMarkdownFrontMatter(source);
  const environment = {};
  return markdown.render(body, environment);
}

export function extractMarkdownHeadings(source: string): MarkdownHeading[] {
  const { body } = parseMarkdownFrontMatter(source);
  const tokens = markdown.parse(body, {});
  const headings: MarkdownHeading[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "heading_open") continue;
    const inline = tokens[index + 1];
    if (!inline || inline.type !== "inline") continue;
    headings.push({
      level: Number(token.tag.slice(1)),
      text: headingText(inline),
      id: String(token.attrGet("id") ?? slugifyMarkdownHeading(inline.content)),
    });
  }

  return headings;
}

function countMarkdownWords(body: string): number {
  const plainText = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`\r\n]*`/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, " ")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, " ")
    .replace(/[#>*_~|[\]{}()]+/g, " ");

  const cjkCount = plainText.match(CJK_CHARACTER_PATTERN)?.length ?? 0;
  const nonCjkText = plainText.replace(CJK_CHARACTER_PATTERN, " ");
  const wordCount = nonCjkText.match(WORD_CHARACTER_PATTERN)?.length ?? 0;
  return cjkCount + wordCount;
}

export function markdownStats(source: string): MarkdownStats {
  const { body } = parseMarkdownFrontMatter(source);
  const wordCount = countMarkdownWords(body);
  return {
    headingCount: extractMarkdownHeadings(source).length,
    wordCount,
    readingMinutes: wordCount === 0 ? 0 : Math.max(1, Math.ceil(wordCount / 250)),
  };
}

export function parseMarkdown(source: string): ParsedMarkdown {
  const { body, frontMatter } = parseMarkdownFrontMatter(source);
  const environment = {};
  const tokens = markdown.parse(body, environment);
  const headings: MarkdownHeading[] = [];
  const wordCount = countMarkdownWords(body);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "heading_open") continue;
    const inline = tokens[index + 1];
    if (!inline || inline.type !== "inline") continue;
    headings.push({
      level: Number(token.tag.slice(1)),
      text: headingText(inline),
      id: String(token.attrGet("id") ?? slugifyMarkdownHeading(inline.content)),
    });
  }

  return {
    body,
    html: markdown.renderer.render(tokens, markdown.options, environment),
    headings,
    stats: {
      headingCount: headings.length,
      wordCount,
      readingMinutes: wordCount === 0 ? 0 : Math.max(1, Math.ceil(wordCount / 250)),
    },
    frontMatter,
  };
}

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
  langPrefix: "language-",
});

markdown.validateLink = isSafeMarkdownUrl;
markdown.use(anchor, {
  slugify: slugifyMarkdownHeading,
  uniqueSlugStartIndex: 2,
  tabIndex: false,
});
markdown.use(footnote);
markdown.use(taskLists, { enabled: false });
markdown.use(emoji);

markdown.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index];
  const language = (token.info.trim().split(/\s+/)[0] ?? "").replace(/[^\w-]/g, "");
  const highlighted = language && hljs.getLanguage(language)
    ? hljs.highlight(token.content, { language, ignoreIllegals: true }).value
    : escapeHtml(token.content);
  const languageClass = language ? ` class="language-${escapeHtml(language)}"` : "";

  return `<pre class="hljs markdown-code-block"><code${languageClass}>${highlighted}</code></pre>\n`;
};
