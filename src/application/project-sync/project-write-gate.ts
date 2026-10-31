import type { ProjectRole } from "@/contracts/account/account";
import type { ProjectEntry } from "@/contracts/modeling/project-manifest";

/** A synced project's documents, as the service's room authorizes writes to them. */
export type ProjectDocumentKind = "manifest" | ProjectEntry["kind"];

export const PROJECT_READ_ONLY_MESSAGE =
  "This project is read-only for your role.";

/**
 * The room's write rule: editors and admins write every document,
 * commenters only the discussion, viewers nothing. A role of null (a local
 * project, or no sync token yet) writes everything.
 */
export function canWriteProjectDocument(
  role: ProjectRole | null,
  kind: ProjectDocumentKind,
) {
  return (
    role === null ||
    role === "admin" ||
    role === "editor" ||
    (role === "commenter" && kind === "discussion")
  );
}

/**
 * The one place the workbench asks before it changes a project document.
 * Automerge cannot retract a local change, so a write the room refuses
 * would be resent on every reconnect: a refused write never starts, and
 * each refusal is announced so the user sees why nothing happened.
 */
export class ProjectWriteGate {
  private currentRole: ProjectRole | null = null;
  private readonly denialListeners = new Set<
    (kind: ProjectDocumentKind) => void
  >();

  get role() {
    return this.currentRole;
  }

  setRole(role: ProjectRole | null) {
    this.currentRole = role;
  }

  allows(kind: ProjectDocumentKind) {
    return canWriteProjectDocument(this.currentRole, kind);
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
