import type { ProjectRole } from "@/contracts/account/account";
import type { ProjectEntry } from "@/contracts/modeling/project-manifest";

/** A synced project's documents, as the service's room authorizes writes to them. */
export type ProjectDocumentKind = "manifest" | ProjectEntry["kind"];

export const PROJECT_READ_ONLY_MESSAGE =
  "This project is read-only for your role.";
export const PROJECT_READ_ONLY_REASON_CODE = "project-read-only";

/**
 * The room's write rule: editors and admins write every document,
 * commenters only the discussion, viewers nothing.
 */
export function canWriteProjectDocument(
  role: ProjectRole,
  kind: ProjectDocumentKind,
) {
  return (
    role === "admin" ||
    role === "editor" ||
    (role === "commenter" && kind === "discussion")
  );
}

/** A project's write access: local, or synced with the role known so far. */
export interface ProjectAccess {
  linked: boolean;
  role: ProjectRole | null;
}

/**
 * A local project writes everything. A synced project writes only what its
 * role allows; until a role is known (no grant remembered or received yet)
 * it writes nothing.
 */
export function projectAccessAllows(
  access: ProjectAccess,
  kind: ProjectDocumentKind,
) {
  return (
    !access.linked ||
    (access.role !== null && canWriteProjectDocument(access.role, kind))
  );
}

/**
 * The workbench asks this gate before it changes a project document through
 * the funnels that guard it (modeling-service edits, part storage writes and
 * resets, part tabs, authoring tools, document undo/redo and reopening).
 * Automerge cannot retract a local change, so a write the room refuses
 * would be resent on every reconnect: a refused write never starts, and
 * each refusal is announced so the user sees why nothing happened.
 */
export class ProjectWriteGate {
  readonly refusal = {
    reasonCode: PROJECT_READ_ONLY_REASON_CODE,
    message: PROJECT_READ_ONLY_MESSAGE,
  };
  private access: ProjectAccess = { linked: false, role: null };
  private readonly denialListeners = new Set<
    (kind: ProjectDocumentKind) => void
  >();

  setAccess(access: ProjectAccess) {
    this.access = access;
  }

  allows(kind: ProjectDocumentKind) {
    return projectAccessAllows(this.access, kind);
  }

  /** Whether a write to `kind` may run; a refusal is announced to the denial listeners. */
  authorize(kind: ProjectDocumentKind) {
    if (this.allows(kind)) return true;
    for (const listener of this.denialListeners) listener(kind);
    return false;
  }

  subscribeToDenials(listener: (kind: ProjectDocumentKind) => void) {
    this.denialListeners.add(listener);
    return () => {
      this.denialListeners.delete(listener);
    };
  }
}
