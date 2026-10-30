export type MarkdownTheme = "light" | "dark" | "sepia";
export type MarkdownFontFamily = "system" | "serif" | "mono";
export type MarkdownNavWeight = "400" | "500" | "600" | "700";
export type MarkdownContentWidth = "narrow" | "comfortable" | "wide" | "full";
export type MarkdownContentPadding = "compact" | "standard" | "roomy";
export type MarkdownHeadingStyle = "modern" | "compact" | "classic";
export type MarkdownTableStyle = "grid" | "striped" | "minimal";

export interface MarkdownReadingSettings {
  theme: MarkdownTheme;
  fontFamily: MarkdownFontFamily;
  fontSize: number;
  lineHeight: number;
  paragraphGap: number;
  codeFontSize: number;
  contentWidth: MarkdownContentWidth;
  contentPadding: MarkdownContentPadding;
  headingStyle: MarkdownHeadingStyle;
  tableStyle: MarkdownTableStyle;
  imageRadius: number;
  navFontFamily: MarkdownFontFamily;
  navFontSize: number;
  navFontWeight: MarkdownNavWeight;
  textColor: string;
  headingColor: string;
  linkColor: string;
  backgroundColor: string;
  codeBackground: string;
}

export const DEFAULT_MARKDOWN_SETTINGS: MarkdownReadingSettings = {
  theme: "light",
  fontFamily: "system",
  fontSize: 16,
  lineHeight: 1.78,
  paragraphGap: 1,
  codeFontSize: 13,
  contentWidth: "comfortable",
  contentPadding: "standard",
  headingStyle: "modern",
  tableStyle: "striped",
  imageRadius: 7,
  navFontFamily: "system",
  navFontSize: 13,
  navFontWeight: "500",
  textColor: "#30465b",
  headingColor: "#20384e",
  linkColor: "#1673c4",
  backgroundColor: "#ffffff",
  codeBackground: "#f7fafc",
};

export const MARKDOWN_THEME_PRESETS: Record<
  MarkdownTheme,
  Pick<MarkdownReadingSettings, "textColor" | "headingColor" | "linkColor" | "backgroundColor" | "codeBackground">
> = {
  light: {
    textColor: "#30465b",
    headingColor: "#20384e",
    linkColor: "#1673c4",
    backgroundColor: "#ffffff",
    codeBackground: "#f7fafc",
  },
  dark: {
    textColor: "#dce8f2",
    headingColor: "#ffffff",
    linkColor: "#79bdff",
    backgroundColor: "#121a23",
    codeBackground: "#0b1219",
  },
  sepia: {
    textColor: "#4d4031",
    headingColor: "#392d21",
    linkColor: "#8a5a1d",
    backgroundColor: "#f7f0df",
    codeBackground: "#eee3cb",
  },
};

const STORAGE_KEY = "xml-viewer-markdown-reading-settings-v1";

function isNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function loadMarkdownSettings(): MarkdownReadingSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_MARKDOWN_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<MarkdownReadingSettings>;
    return {
      ...DEFAULT_MARKDOWN_SETTINGS,
      ...parsed,
      fontSize: isNumberInRange(parsed.fontSize, 13, 24)
        ? parsed.fontSize
        : DEFAULT_MARKDOWN_SETTINGS.fontSize,
      lineHeight: isNumberInRange(parsed.lineHeight, 1.35, 2.3)
        ? parsed.lineHeight
        : DEFAULT_MARKDOWN_SETTINGS.lineHeight,
      paragraphGap: isNumberInRange(parsed.paragraphGap, 0.65, 1.7)
        ? parsed.paragraphGap
        : DEFAULT_MARKDOWN_SETTINGS.paragraphGap,
      codeFontSize: isNumberInRange(parsed.codeFontSize, 10, 18)
        ? parsed.codeFontSize
        : DEFAULT_MARKDOWN_SETTINGS.codeFontSize,
      imageRadius: isNumberInRange(parsed.imageRadius, 0, 24)
        ? parsed.imageRadius
        : DEFAULT_MARKDOWN_SETTINGS.imageRadius,
      navFontSize: isNumberInRange(parsed.navFontSize, 11, 20)
        ? parsed.navFontSize
        : DEFAULT_MARKDOWN_SETTINGS.navFontSize,
    };
  } catch {
    return DEFAULT_MARKDOWN_SETTINGS;
  }
}

export function saveMarkdownSettings(settings: MarkdownReadingSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function applyMarkdownTheme(
  settings: MarkdownReadingSettings,
  theme: MarkdownTheme,
): MarkdownReadingSettings {
  return {
    ...settings,
    theme,
    ...MARKDOWN_THEME_PRESETS[theme],
  };
}

export function markdownSettingsVars(
  settings: MarkdownReadingSettings,
): Record<string, string> {
  const width = {
    narrow: "720px",
    comfortable: "900px",
    wide: "1120px",
    full: "none",
  }[settings.contentWidth];
  const padding = {
    compact: "28px",
    standard: "48px",
    roomy: "72px",
  }[settings.contentPadding];
  const fontFamily = {
    system: '"Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif',
    serif: 'Georgia, "Noto Serif SC", "Songti SC", serif',
    mono: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
  }[settings.fontFamily];
  const navFontFamily = {
    system: '"Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif',
    serif: 'Georgia, "Noto Serif SC", "Songti SC", serif',
    mono: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
  }[settings.navFontFamily];

  return {
    "--md-font-size": `${settings.fontSize}px`,
    "--md-line-height": String(settings.lineHeight),
    "--md-paragraph-gap": `${settings.paragraphGap}em`,
    "--md-code-font-size": `${settings.codeFontSize}px`,
    "--md-width": width,
    "--md-padding-x": padding,
    "--md-font-family": fontFamily,
    "--md-text": settings.textColor,
    "--md-heading": settings.headingColor,
    "--md-link": settings.linkColor,
    "--md-bg": settings.backgroundColor,
    "--md-code-bg": settings.codeBackground,
    "--md-image-radius": `${settings.imageRadius}px`,
    "--md-nav-font-family": navFontFamily,
    "--md-nav-font-size": `${settings.navFontSize}px`,
    "--md-nav-font-weight": settings.navFontWeight,
  };
}
