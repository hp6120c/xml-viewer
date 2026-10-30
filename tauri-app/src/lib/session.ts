const STORAGE_KEY = "xml-viewer-session-v2";

export interface SessionState {
  paths: string[];
  activePath: string | null;
  zoom: number;
  sidebarWidths?: {
    xml: number;
    markdown: number;
  };
}

export function loadSession(): SessionState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionState>;
    return {
      paths: Array.isArray(parsed.paths)
        ? parsed.paths.filter((path): path is string => typeof path === "string")
        : [],
      activePath: typeof parsed.activePath === "string" ? parsed.activePath : null,
      zoom: typeof parsed.zoom === "number" && Number.isFinite(parsed.zoom)
        ? Math.min(140, Math.max(80, parsed.zoom))
        : 100,
      sidebarWidths: parsed.sidebarWidths
        && typeof parsed.sidebarWidths.xml === "number"
        && typeof parsed.sidebarWidths.markdown === "number"
        ? {
          xml: Math.min(520, Math.max(200, parsed.sidebarWidths.xml)),
          markdown: Math.min(520, Math.max(200, parsed.sidebarWidths.markdown)),
        }
        : undefined,
    };
  } catch {
    return null;
  }
}

export function saveSession(state: SessionState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Session persistence must never block the viewer.
  }
}


