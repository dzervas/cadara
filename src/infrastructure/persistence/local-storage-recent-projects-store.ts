import { recordRecentProject } from "@/core/project-sync/recent-projects";
import type { StorageLike } from "./local-storage-workbench-tabs-store";

const RECENT_PROJECTS_KEY = "cad.workbench.recentProjects.v1";

/** The ids of the projects this browser opened, most recent first. */
export function createLocalStorageRecentProjectsStore(storage: StorageLike) {
  const load = (): string[] => {
    const serialized = storage.getItem(RECENT_PROJECTS_KEY);
    if (serialized === null) return [];
    let stored: unknown;
    try {
      stored = JSON.parse(serialized);
    } catch {
      // A damaged entry only orders the menu; the next open replaces it.
      return [];
    }
    return Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === "string")
      : [];
  };
  return {
    load,
    /** Records `projectId` as opened now; returns the new order. */
    record(projectId: string) {
      const next = recordRecentProject(load(), projectId);
      storage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(next));
      return next;
    },
  };
}
