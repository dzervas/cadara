import type { ProjectManifest } from "@/contracts/modeling/project-manifest";
import type { DocumentId } from "@/contracts/shared/ids";
import type {
  ProjectServicePort,
  ProjectSyncTransport,
  SyncedProjectStore,
} from "./project-service-port";
import { startProjectSync } from "./project-service-use-cases";
import { canWriteProjectDocument } from "./project-write-gate";

/** The steps of Move to project, the same between any two projects. */
export interface MoveProjectDocumentSteps {
  /** Settles once every requested local edit is stored, so the copy has them. */
  waitForLocalChanges(): Promise<void>;
  /** Rejects when the user cannot edit both projects. */
  checkAccess(): Promise<void>;
  /** Persists the copy with its whole history under a new identity. */
  cloneWithHistory(): Promise<DocumentId>;
  addToTarget(documentId: DocumentId): Promise<void>;
  /** A local target is durable once added; an account target waits for its room. */
  confirmTarget(documentId: DocumentId): Promise<void>;
  removeFromSource(): Promise<void>;
}

export const MOVE_NOT_CONFIRMED_MESSAGE =
  "The copy in the target project was not confirmed, so the original was kept. The copy stays in the target project.";

export const SOURCE_REMOVAL_NOT_CONFIRMED_MESSAGE =
  "The part moved, but its removal from the original project has not reached CADara yet. It syncs the next time you open that project.";

/**
 * Copies, lists in the target, waits for the target to hold the copy, and
 * only then unlists the source: any failure before that leaves the source
 * as it was. A duplicate is acceptable, losing the document is not.
 */
export async function moveProjectDocument(
  steps: MoveProjectDocumentSteps,
): Promise<DocumentId> {
  await steps.waitForLocalChanges();
  await steps.checkAccess();
  const documentId = await steps.cloneWithHistory();
  await steps.addToTarget(documentId);
  try {
    await steps.confirmTarget(documentId);
  } catch (error) {
    throw new Error(MOVE_NOT_CONFIRMED_MESSAGE, { cause: error });
  }
  await steps.removeFromSource();
  return documentId;
}

/** The local project catalog operations Move to project needs. */
export interface ProjectMoveStore extends SyncedProjectStore {
  addPart(
    projectId: string,
    entry: { name: string; docId: DocumentId },
  ): Promise<ProjectManifest>;
  removePart(projectId: string, docId: DocumentId): Promise<ProjectManifest>;
}

export interface MovedProjectDocument {
  documentId: DocumentId;
  /** Releases this move's hold on the target's connection; call it after switching there. */
  release: () => void;
  /** Set when an account source's room did not confirm the removal in time. */
  sourceRemovalUnconfirmed: Error | null;
}

/**
 * Move to project between two catalog projects. An account target must let
 * the user edit, and its room must hold the copy's current heads before the
 * source unlists the part; an account source then waits (bounded) for its
 * room to hold the manifest without the part, so collaborators stop editing
 * it there. That last wait only reports: the move has happened by then.
 */
export async function moveDocumentBetweenProjects(input: {
  source: ProjectManifest;
  target: ProjectManifest;
  documentId: DocumentId;
  projects: ProjectMoveStore;
  service: ProjectServicePort;
  transport: ProjectSyncTransport | null;
  createDocumentId: () => DocumentId;
  waitForLocalChanges: () => Promise<void>;
  cloneWithHistory: (
    documentId: DocumentId,
    targetDocumentId: DocumentId,
  ) => Promise<void>;
}): Promise<MovedProjectDocument> {
  const { source, target, projects, service, transport } = input;
  if (source.projectId === target.projectId)
    throw new Error("Choose a different project.");
  const entry = source.entries.find(
    (candidate) =>
      candidate.kind === "part" && candidate.docId === input.documentId,
  );
  if (!entry) throw new Error("The part is not in this project.");
  let release = () => {};
  let copyAutomergeDocumentId: string | null = null;
  try {
    const documentId = await moveProjectDocument({
      waitForLocalChanges: input.waitForLocalChanges,
      async checkAccess() {
        if (!target.service) return;
        if (!transport)
          throw new Error("Account projects need browser storage.");
        const grant = await service.issueSyncGrant(target.service);
        if (!canWriteProjectDocument(grant.role, "part"))
          throw new Error("You need editor access to the target project.");
      },
      async cloneWithHistory() {
        const documentId = input.createDocumentId();
        await input.cloneWithHistory(input.documentId, documentId);
        return documentId;
      },
      async addToTarget(documentId) {
        const added = await projects.addPart(target.projectId, {
          name: entry.name,
          docId: documentId,
        });
        copyAutomergeDocumentId =
          added.entries.find((candidate) => candidate.docId === documentId)
            ?.automergeDocumentId ?? null;
        if (!copyAutomergeDocumentId)
          throw new Error("The target project did not list the copy.");
      },
      async confirmTarget() {
        if (!target.service || !transport) return;
        release = await startProjectSync(
          { service, transport, projects },
          target.service,
          await projects.manifestDocumentId(target.projectId),
        );
        await transport.whenSynced(target.service, copyAutomergeDocumentId!);
      },
      async removeFromSource() {
        await projects.removePart(source.projectId, input.documentId);
      },
    });
    let sourceRemovalUnconfirmed: Error | null = null;
    if (source.service)
      try {
        if (!transport) throw new Error("Project sync is not running.");
        await transport.whenSynced(
          source.service,
          await projects.manifestDocumentId(source.projectId),
        );
      } catch (error) {
        sourceRemovalUnconfirmed = new Error(
          SOURCE_REMOVAL_NOT_CONFIRMED_MESSAGE,
          { cause: error },
        );
      }
    return { documentId, release, sourceRemovalUnconfirmed };
  } catch (error) {
    release();
    throw error;
  }
}
