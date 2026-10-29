import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Code2,
  Columns3,
  Image,
  Palette,
  RotateCcw,
  Table2,
  Type,
  X,
} from "lucide-react";
import {
  applyMarkdownTheme,
  DEFAULT_MARKDOWN_SETTINGS,
  type MarkdownContentPadding,
  type MarkdownContentWidth,
  type MarkdownFontFamily,
  type MarkdownHeadingStyle,
  type MarkdownReadingSettings,
  type MarkdownTableStyle,
  type MarkdownTheme,
} from "../lib/markdown-settings";
import "../markdown-settings.css";

interface MarkdownSettingsPanelProps {
  open: boolean;
  settings: MarkdownReadingSettings;
  onChange: (settings: MarkdownReadingSettings) => void;
  onClose: () => void;
}

const THEMES: Array<{ id: MarkdownTheme; label: string }> = [
  { id: "light", label: "明亮" },
  { id: "dark", label: "暗色" },
  { id: "sepia", label: "护眼" },
];

export function MarkdownSettingsPanel({
  open,
  settings,
  onChange,
  onClose,
}: MarkdownSettingsPanelProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const update = <K extends keyof MarkdownReadingSettings>(
    key: K,
    value: MarkdownReadingSettings[K],
  ) => onChange({ ...settings, [key]: value });

  return createPortal(
    <div className="markdown-settings-layer">
      <button
        type="button"
        className="markdown-settings-backdrop"
        aria-label="关闭阅读设置"
        onClick={onClose}
      />
      <aside className="markdown-settings-panel" role="dialog" aria-modal="true" aria-label="Markdown 阅读样式">
        <header className="markdown-settings-heading">
          <div>
            <span className="eyebrow">Markdown 基础阅读样式</span>
            <h2>基础阅读样式</h2>
            <p>设置整篇预览的默认样式；选中文字后可使用浮动局部样式工具。</p>
          </div>
          <button type="button" className="markdown-settings-close" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="markdown-settings-scroll">
          <section className="markdown-settings-section">
            <div className="markdown-settings-section-title"><Palette size={16} />主题</div>
            <div className="markdown-theme-grid">
              {THEMES.map((theme) => (
                <button
                  type="button"
                  className={`markdown-theme-card theme-${theme.id} ${settings.theme === theme.id ? "active" : ""}`}
                  key={theme.id}
                  onClick={() => onChange(applyMarkdownTheme(settings, theme.id))}
                >
                  <span className="markdown-theme-swatch" />
                  <span>{theme.label}</span>
                  {settings.theme === theme.id && <Check size={14} />}
                </button>
              ))}
            </div>
          </section>

          <section className="markdown-settings-section">
            <div className="markdown-settings-section-title"><Type size={16} />排版</div>
            <label className="markdown-setting-row">
              <span>正文字体</span>
              <select
                value={settings.fontFamily}
                onChange={(event) => update("fontFamily", event.target.value as MarkdownFontFamily)}
              >
                <option value="system">系统无衬线</option>
                <option value="serif">中文衬线</option>
                <option value="mono">等宽字体</option>
              </select>
            </label>
            <label className="markdown-setting-range">
              <span>正文字号 <strong>{settings.fontSize}px</strong></span>
              <input
                type="range"
                min="13"
                max="24"
                step="1"
                value={settings.fontSize}
                onChange={(event) => update("fontSize", Number(event.target.value))}
              />
            </label>
            <label className="markdown-setting-range">
              <span>行高 <strong>{settings.lineHeight.toFixed(2)}</strong></span>
              <input
                type="range"
                min="1.35"
                max="2.3"
                step="0.05"
                value={settings.lineHeight}
                onChange={(event) => update("lineHeight", Number(event.target.value))}
              />
            </label>
            <label className="markdown-setting-range">
              <span>段落间距 <strong>{settings.paragraphGap.toFixed(2)}em</strong></span>
              <input
                type="range"
                min="0.65"
                max="1.7"
                step="0.05"
                value={settings.paragraphGap}
                onChange={(event) => update("paragraphGap", Number(event.target.value))}
              />
            </label>
            <label className="markdown-setting-range">
              <span>代码字号 <strong>{settings.codeFontSize}px</strong></span>
              <input
                type="range"
                min="10"
                max="18"
                step="1"
                value={settings.codeFontSize}
                onChange={(event) => update("codeFontSize", Number(event.target.value))}
              />
            </label>
          </section>

          <section className="markdown-settings-section">
            <div className="markdown-settings-section-title"><Columns3 size={16} />页面布局</div>
            <label className="markdown-setting-row">
              <span>阅读宽度</span>
              <select
                value={settings.contentWidth}
                onChange={(event) => update("contentWidth", event.target.value as MarkdownContentWidth)}
              >
                <option value="narrow">窄（720px）</option>
                <option value="comfortable">舒适（900px）</option>
                <option value="wide">宽（1120px）</option>
                <option value="full">铺满可用宽度</option>
              </select>
            </label>
            <label className="markdown-setting-row">
              <span>左右留白</span>
              <select
                value={settings.contentPadding}
                onChange={(event) => update("contentPadding", event.target.value as MarkdownContentPadding)}
              >
                <option value="compact">紧凑</option>
                <option value="standard">标准</option>
                <option value="roomy">宽松</option>
              </select>
            </label>
            <label className="markdown-setting-range">
              <span>图片圆角 <strong>{settings.imageRadius}px</strong></span>
              <input
                type="range"
                min="0"
                max="24"
                step="1"
                value={settings.imageRadius}
                onChange={(event) => update("imageRadius", Number(event.target.value))}
              />
            </label>
          </section>

          <section className="markdown-settings-section">
            <div className="markdown-settings-section-title"><Table2 size={16} />标题与内容</div>
            <label className="markdown-setting-row">
              <span>标题风格</span>
              <select
                value={settings.headingStyle}
                onChange={(event) => update("headingStyle", event.target.value as MarkdownHeadingStyle)}
              >
                <option value="modern">现代</option>
                <option value="compact">紧凑</option>
                <option value="classic">经典衬线</option>
              </select>
            </label>
            <label className="markdown-setting-row">
              <span>表格风格</span>
              <select
                value={settings.tableStyle}
                onChange={(event) => update("tableStyle", event.target.value as MarkdownTableStyle)}
              >
                <option value="grid">网格</option>
                <option value="striped">斑马纹</option>
                <option value="minimal">极简</option>
              </select>
            </label>
          </section>

          <section className="markdown-settings-section">
            <div className="markdown-settings-section-title"><Code2 size={16} />颜色</div>
            <div className="markdown-color-grid">
              <label>
                <span>正文</span>
                <input type="color" value={settings.textColor} onChange={(event) => update("textColor", event.target.value)} />
              </label>
              <label>
                <span>标题</span>
                <input type="color" value={settings.headingColor} onChange={(event) => update("headingColor", event.target.value)} />
              </label>
              <label>
                <span>链接</span>
                <input type="color" value={settings.linkColor} onChange={(event) => update("linkColor", event.target.value)} />
              </label>
              <label>
                <span>背景</span>
                <input type="color" value={settings.backgroundColor} onChange={(event) => update("backgroundColor", event.target.value)} />
              </label>
              <label>
                <span>代码背景</span>
                <input type="color" value={settings.codeBackground} onChange={(event) => update("codeBackground", event.target.value)} />
              </label>
            </div>
          </section>

          <section className="markdown-settings-section markdown-settings-about">
            <Image size={16} />
            <p>这些设置只影响 Markdown 预览，不改变 XML 表格布局，也不会写入 Markdown 文件。</p>
          </section>
        </div>

        <footer className="markdown-settings-footer">
          <button type="button" className="secondary-button" onClick={() => onChange(DEFAULT_MARKDOWN_SETTINGS)}>
            <RotateCcw size={15} />恢复默认
          </button>
          <button type="button" className="primary-button" onClick={onClose}>
            <Check size={15} />完成
          </button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
