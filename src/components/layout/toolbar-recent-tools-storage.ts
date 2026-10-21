interface ToolbarRecentToolsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const TOOLBAR_RECENT_TOOLS_STORAGE_KEY =
  "cad.workbench.toolbarRecentTools.v1";

function getDefaultToolbarRecentToolsStorage(): ToolbarRecentToolsStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function readToolbarRecentTools(
  storage: ToolbarRecentToolsStorage | null = getDefaultToolbarRecentToolsStorage(),
): string[] {
  if (!storage) {
    return [];
  }

  try {
    const stored = storage.getItem(TOOLBAR_RECENT_TOOLS_STORAGE_KEY);
    const parsed: unknown = stored === null ? [] : JSON.parse(stored);
    return Array.isArray(parsed) &&
      parsed.every((toolId) => typeof toolId === "string")
      ? parsed
      : [];
  } catch (error) {
    console.warn("Toolbar recent tools could not be read.", error);
    return [];
  }
}

export function writeToolbarRecentTools(
  toolIds: readonly string[],
  storage: ToolbarRecentToolsStorage | null = getDefaultToolbarRecentToolsStorage(),
) {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(TOOLBAR_RECENT_TOOLS_STORAGE_KEY, JSON.stringify(toolIds));
  } catch (error) {
    console.warn("Toolbar recent tools could not be saved.", error);
  }
}
