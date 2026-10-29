import { useEffect, useState } from "react";
import { Bold, Check, Italic, Underline, X } from "lucide-react";
import "../markdown-selection-toolbar.css";

export interface MarkdownLocalStyle {
  fontSize?: string;
  fontFamily?: string;
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

interface MarkdownSelectionToolbarProps {
  rect: DOMRect;
  onApply: (style: MarkdownLocalStyle) => void;
  onClose: () => void;
}

export function MarkdownSelectionToolbar({
  rect,
  onApply,
  onClose,
}: MarkdownSelectionToolbarProps) {
  const [fontSize, setFontSize] = useState("");
  const [fontFamily, setFontFamily] = useState("");
  const [color, setColor] = useState("#20384e");
  const [backgroundColor, setBackgroundColor] = useState("#fff0a8");
  const [colorTouched, setColorTouched] = useState(false);
  const [backgroundTouched, setBackgroundTouched] = useState(false);
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [underline, setUnderline] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="markdown-selection-toolbar"
      style={{
        left: rect.left + rect.width / 2,
        top: Math.max(8, rect.top - 10),
      }}
      onMouseDown={(event) => event.preventDefault()}
      role="toolbar"
      aria-label="选中内容样式"
    >
      <div className="markdown-selection-toolbar-row">
        <span className="markdown-selection-toolbar-title">局部样式</span>
        <button
          type="button"
          className={`markdown-selection-icon ${bold ? "active" : ""}`}
          onClick={() => setBold((value) => !value)}
          aria-label="加粗"
          title="加粗"
        >
          <Bold size={15} />
        </button>
        <button
          type="button"
          className={`markdown-selection-icon ${italic ? "active" : ""}`}
          onClick={() => setItalic((value) => !value)}
          aria-label="斜体"
          title="斜体"
        >
          <Italic size={15} />
        </button>
        <button
          type="button"
          className={`markdown-selection-icon ${underline ? "active" : ""}`}
          onClick={() => setUnderline((value) => !value)}
          aria-label="下划线"
          title="下划线"
        >
          <Underline size={15} />
        </button>
        <span className="markdown-selection-divider" />
        <select
          value={fontSize}
          onChange={(event) => setFontSize(event.target.value)}
          aria-label="选中内容字号"
        >
          <option value="">字号</option>
          <option value="12px">12</option>
          <option value="14px">14</option>
          <option value="16px">16</option>
          <option value="18px">18</option>
          <option value="20px">20</option>
          <option value="24px">24</option>
          <option value="28px">28</option>
          <option value="32px">32</option>
        </select>
        <select
          value={fontFamily}
          onChange={(event) => setFontFamily(event.target.value)}
          aria-label="选中内容字体"
        >
          <option value="">字体</option>
          <option value="system">无衬线</option>
          <option value="serif">衬线</option>
          <option value="mono">等宽</option>
        </select>
        <label className="markdown-selection-color" title="文字颜色">
          <span>A</span>
          <input
            type="color"
            value={color}
            onChange={(event) => {
              setColor(event.target.value);
              setColorTouched(true);
            }}
            aria-label="文字颜色"
          />
        </label>
        <label className="markdown-selection-color" title="高亮背景">
          <span className="highlight-swatch">▰</span>
          <input
            type="color"
            value={backgroundColor}
            onChange={(event) => {
              setBackgroundColor(event.target.value);
              setBackgroundTouched(true);
            }}
            aria-label="高亮背景"
          />
        </label>
        <button
          type="button"
          className="markdown-selection-apply"
          onClick={() => onApply({
            fontSize: fontSize || undefined,
            fontFamily: fontFamily || undefined,
            color: colorTouched ? color : undefined,
            backgroundColor: backgroundTouched ? backgroundColor : undefined,
            bold,
            italic,
            underline,
          })}
        >
          <Check size={14} />应用
        </button>
        <button type="button" className="markdown-selection-close" onClick={onClose} aria-label="关闭局部样式">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
