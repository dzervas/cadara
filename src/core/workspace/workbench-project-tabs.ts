import type { ProjectManifest } from "@/contracts/modeling/project-manifest";
import type { DocumentId } from "@/contracts/shared/ids";
import type { WorkbenchTabsState } from "./workbench-tabs";

/** Manifest membership and names are durable; cached tabs supply presentation and the active part. */
export function createWorkbenchProjectTabs(
  project: ProjectManifest,
  cached: WorkbenchTabsState | null,
  initial: WorkbenchTabsState,
): WorkbenchTabsState {
  const tabs = project.entries
    .filter((entry) => entry.kind === "part")
    .map((entry) => ({
      documentId: entry.docId,
      storageKind: "browser" as const,
      storageDescriptor: null,
      ...cached?.tabs.find((tab) => tab.documentId === entry.docId),
      title: entry.name,
    }));
  const active = cached?.activeDocumentId ?? initial.activeDocumentId;
  return {
    tabs,
    activeDocumentId:
      tabs.find((tab) => tab.documentId === active)?.documentId ??
      tabs[0].documentId,
  };
}

/**
 * New/Open can finish while discovery is pending; their real documents must
 * join the project. A first-part placeholder (the part a browser without a
 * project session mounts before discovery) joins only when the discovered
 * project lists it, so finding an existing project never adds a stray part.
 */
export function mergeDiscoveredWorkbenchProjectTabs(
  project: ProjectManifest,
  current: WorkbenchTabsState,
  placeholderDocumentId: DocumentId | null = null,
): WorkbenchTabsState {
  const discovered = createWorkbenchProjectTabs(project, current, current);
  const ids = new Set(discovered.tabs.map((tab) => tab.documentId));
  const joining = current.tabs.filter(
    (tab) =>
      !ids.has(tab.documentId) && tab.documentId !== placeholderDocumentId,
  );
  const tabs = [...discovered.tabs, ...joining];
  return {
    tabs,
    activeDocumentId: tabs.some(
      (tab) => tab.documentId === current.activeDocumentId,
    )
      ? current.activeDocumentId
      : discovered.activeDocumentId,
  };
}

/**
 * A manifest change (a collaborator's, or this browser's own write) applied
 * to the open tabs: parts the change added open, parts it removed close and
 * parts it renamed follow. Local presentation (order, storage) is kept, and
 * the last tab never closes.
 */
export function followWorkbenchProjectManifest(
  previous: ProjectManifest,
  next: ProjectManifest,
  current: WorkbenchTabsState,
): WorkbenchTabsState {
  const parts = (manifest: ProjectManifest) =>
    new Map(
      manifest.entries
        .filter((entry) => entry.kind === "part")
        .map((entry) => [entry.docId, entry.name] as const),
    );
  const before = parts(previous);
  const after = parts(next);
  let changed = false;
  const tabs = current.tabs.flatMap((tab) => {
    if (before.has(tab.documentId) && !after.has(tab.documentId)) {
      changed = true;
      return [];
    }
    const name = after.get(tab.documentId);
    if (
      name === undefined ||
      before.get(tab.documentId) === name ||
      tab.title === name
    )
      return [tab];
    changed = true;
    return [{ ...tab, title: name }];
  });
  for (const [documentId, title] of after)
    if (
      !before.has(documentId) &&
      !tabs.some((tab) => tab.documentId === documentId)
    ) {
      changed = true;
      tabs.push({
        documentId,
        title,
        storageKind: "browser",
        storageDescriptor: null,
      });
    }
  if (!changed || tabs.length === 0) return current;
  return {
    tabs,
    activeDocumentId: tabs.some(
      (tab) => tab.documentId === current.activeDocumentId,
    )
      ? current.activeDocumentId
      : tabs[0]!.documentId,
  };
}
