import { FileText, ListTree } from "lucide-react";
import type { MarkdownHeading } from "../lib/markdown";

interface MarkdownOutlineProps {
  headings: MarkdownHeading[];
  fileName: string;
  search: string;
}

export function MarkdownOutline({ headings, fileName, search }: MarkdownOutlineProps) {
  const needle = search.trim().toLocaleLowerCase();
  const visible = needle
    ? headings.filter((heading) => heading.text.toLocaleLowerCase().includes(needle))
    : headings;

  return (
    <aside className="sidebar markdown-outline">
      <div className="sidebar-title">
        <span><ListTree size={16} />文档大纲</span>
        <span className="sidebar-count">{headings.length}</span>
      </div>
      <div className="markdown-file-label" title={fileName}>
        <FileText size={14} />{fileName}
      </div>
      <div className="markdown-toc-list">
        {visible.length > 0 ? visible.map((heading, index) => (
          <a
            className={`markdown-toc-item level-${Math.min(heading.level, 6)}`}
            href={`#${heading.id}`}
            key={`${heading.id}:${index}`}
            onClick={(event) => {
              event.preventDefault();
              const target = document.getElementById(heading.id);
              target?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            <span>{heading.text || "未命名标题"}</span>
          </a>
        )) : (
          <div className="markdown-toc-empty">
            {search ? "没有匹配的标题" : "文档中没有标题"}
          </div>
        )}
      </div>
    </aside>
  );
}
