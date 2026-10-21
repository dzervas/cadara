/**
 * Most-recently-used toolbar tools, newest first. A dropdown shows the most
 * recent of its tools on its face and lists it first.
 */

export const TOOLBAR_RECENT_TOOLS_LIMIT = 64;

export function recordRecentToolbarTool(
  recentToolIds: readonly string[],
  toolId: string,
): string[] {
  return [toolId, ...recentToolIds.filter((id) => id !== toolId)].slice(
    0,
    TOOLBAR_RECENT_TOOLS_LIMIT,
  );
}

export function pickRecentToolbarTool<T extends { id: string }>(
  candidates: readonly T[],
  recentToolIds: readonly string[],
): T | undefined {
  for (const recentId of recentToolIds) {
    const candidate = candidates.find((tool) => tool.id === recentId);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

export function promoteRecentToolbarTool<T extends { id: string }>(
  candidates: readonly T[],
  recentToolIds: readonly string[],
): T[] {
  const recent = pickRecentToolbarTool(candidates, recentToolIds);
  return recent
    ? [recent, ...candidates.filter((tool) => tool !== recent)]
    : [...candidates];
}
