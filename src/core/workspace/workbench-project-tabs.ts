import type { ProjectManifest } from "@/contracts/modeling/project-manifest";
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

/** New/Open can finish while discovery is pending; their real documents must join the project. */
export function mergeDiscoveredWorkbenchProjectTabs(
  project: ProjectManifest,
  current: WorkbenchTabsState,
): WorkbenchTabsState {
  const discovered = createWorkbenchProjectTabs(project, current, current);
  const ids = new Set(discovered.tabs.map((tab) => tab.documentId));
  return {
    tabs: [
      ...discovered.tabs,
      ...current.tabs.filter((tab) => !ids.has(tab.documentId)),
    ],
    activeDocumentId: current.activeDocumentId,
  };
}
