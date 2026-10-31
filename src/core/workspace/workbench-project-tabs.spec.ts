import { expect, test } from "vitest";
import type { ProjectManifest } from "@/contracts/modeling/project-manifest";
import type { WorkbenchTab, WorkbenchTabsState } from "./workbench-tabs";
import { reduceWorkbenchTabs } from "./workbench-tabs";
import {
  createWorkbenchProjectTabs,
  followWorkbenchProjectManifest,
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
    automergeDocumentId: `automerge_${tab.documentId}`,
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

test("a collaborator's manifest change opens added parts, closes removed ones and follows renames", () => {
  const open: WorkbenchTabsState = {
    tabs: [second, first],
    activeDocumentId: second.documentId,
  };
  const next: ProjectManifest = {
    ...project,
    entries: [
      { ...project.entries[0]!, name: "Body" },
      {
        kind: "part",
        automergeDocumentId: "automerge_doc_c",
        docId: "doc_c",
        name: "Hinge",
      },
    ],
  };
  expect(followWorkbenchProjectManifest(project, next, open)).toEqual({
    tabs: [
      { ...first, title: "Body" },
      { ...first, documentId: "doc_c", title: "Hinge" },
    ],
    activeDocumentId: first.documentId,
  });
});

test("an unchanged part list keeps the tabs state, and the last tab never closes", () => {
  const open: WorkbenchTabsState = {
    tabs: [first],
    activeDocumentId: first.documentId,
  };
  expect(followWorkbenchProjectManifest(project, project, open)).toBe(open);
  expect(
    followWorkbenchProjectManifest(project, { ...project, entries: [] }, open),
  ).toBe(open);
});

test("a first-part placeholder joins a discovered project only when the project lists it", () => {
  const placeholder: WorkbenchTab = {
    ...first,
    documentId: "doc_placeholder",
    title: "Workspace",
  };
  const mounted: WorkbenchTabsState = {
    tabs: [placeholder],
    activeDocumentId: placeholder.documentId,
  };

  expect(
    mergeDiscoveredWorkbenchProjectTabs(
      project,
      mounted,
      placeholder.documentId,
    ),
    "an existing project opens its own first part",
  ).toEqual({ tabs: [first, second], activeDocumentId: first.documentId });

  const created = {
    ...project,
    entries: [
      {
        kind: "part" as const,
        automergeDocumentId: "automerge_doc_placeholder",
        docId: placeholder.documentId,
        name: placeholder.title,
      },
    ],
  };
  expect(
    mergeDiscoveredWorkbenchProjectTabs(
      created,
      mounted,
      placeholder.documentId,
    ),
    "the project created from the placeholder keeps it",
  ).toEqual(mounted);
});
