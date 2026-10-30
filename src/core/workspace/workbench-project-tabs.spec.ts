import { expect, test } from "vitest";
import type { ProjectManifest } from "@/contracts/modeling/project-manifest";
import type { WorkbenchTab, WorkbenchTabsState } from "./workbench-tabs";
import { reduceWorkbenchTabs } from "./workbench-tabs";
import {
  createWorkbenchProjectTabs,
  mergeDiscoveredWorkbenchProjectTabs,
} from "./workbench-project-tabs";

const first: WorkbenchTab = {
  documentId: "doc_a",
  title: "Base",
  storageKind: "browser",
  storageDescriptor: null,
};
const second: WorkbenchTab = { ...first, documentId: "doc_b", title: "Lid" };
const project: ProjectManifest = {
  format: "cadara-project",
  schemaVersion: 1,
  projectId: "enclosure",
  name: "Enclosure",
  entries: [first, second].map((tab) => ({
    kind: "part",
    automergeDocumentId: "automerge_part",
    docId: tab.documentId,
    name: tab.title,
  })),
  versions: [],
};

test("legacy adoption keeps the non-first active part when no project tab cache exists", () => {
  const legacy: WorkbenchTabsState = {
    tabs: [first, second],
    activeDocumentId: second.documentId,
  };
  expect(createWorkbenchProjectTabs(project, null, legacy)).toEqual(legacy);
  expect(mergeDiscoveredWorkbenchProjectTabs(project, legacy)).toEqual(legacy);
});

test("a valid synchronous session keeps its active part when the project tab cache is missing", () => {
  const session: WorkbenchTabsState = {
    tabs: [second],
    activeDocumentId: second.documentId,
  };
  const restored = createWorkbenchProjectTabs(project, null, session);
  expect(restored.tabs).toEqual([first, second]);
  expect(restored.activeDocumentId).toBe(second.documentId);
});

test("New and Open during project discovery survive manifest reconciliation", () => {
  const pending: WorkbenchTabsState = {
    tabs: [first],
    activeDocumentId: first.documentId,
  };
  const opened = reduceWorkbenchTabs(pending, {
    type: "open",
    tab: second,
    activate: true,
  });
  const discovered = { ...project, entries: project.entries.slice(0, 1) };
  const reconciled = mergeDiscoveredWorkbenchProjectTabs(discovered, opened);
  expect(reconciled.tabs).toEqual([first, second]);
  expect(reconciled.activeDocumentId).toBe(second.documentId);
  expect(
    mergeDiscoveredWorkbenchProjectTabs({ ...project }, reconciled),
  ).toEqual(reconciled);
});
