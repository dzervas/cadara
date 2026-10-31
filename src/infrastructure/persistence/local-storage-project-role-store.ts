import type { ProjectRole } from "@/contracts/account/account";
import type { ProjectServiceLink } from "@/contracts/modeling/project-manifest";
import type { StorageLike } from "./local-storage-workbench-tabs-store";

const PROJECT_ROLES: readonly ProjectRole[] = [
  "admin",
  "editor",
  "commenter",
  "viewer",
];

/**
 * The role of the last sync token this browser received for a synced
 * project, so a reload (or an offline session) knows what it may write
 * before the next token arrives.
 */
export interface ProjectRoleStore {
  /** The remembered role for `userId`; with no user yet, the last user's. */
  load(link: ProjectServiceLink, userId: string | null): ProjectRole | null;
  save(link: ProjectServiceLink, userId: string, role: ProjectRole): void;
}

export function createLocalStorageProjectRoleStore(
  storage: StorageLike,
): ProjectRoleStore {
  const key = (link: ProjectServiceLink) =>
    `cad.projectSync.role.v1:${link.orgId}/${link.projectId}`;
  return {
    load(link, userId) {
      const serialized = storage.getItem(key(link));
      if (serialized === null) return null;
      let stored: unknown;
      try {
        stored = JSON.parse(serialized);
      } catch {
        // A damaged entry remembers nothing; the next token replaces it.
        return null;
      }
      const { userId: storedUserId, role } = (stored ?? {}) as {
        userId?: unknown;
        role?: unknown;
      };
      if (!PROJECT_ROLES.includes(role as ProjectRole)) return null;
      if (userId !== null && storedUserId !== userId) return null;
      return role as ProjectRole;
    },
    save(link, userId, role) {
      storage.setItem(key(link), JSON.stringify({ userId, role }));
    },
  };
}
