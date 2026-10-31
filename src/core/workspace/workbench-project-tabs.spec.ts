import { expect, test } from "vitest";
import type { ProjectManifest } from "@/contracts/modeling/project-manifest";
import type { WorkbenchTab, WorkbenchTabsState } from "./workbench-tabs";
import { reduceWorkbenchTabs } from "./workbench-tabs";
import {
  createWorkbenchProjectTabs,
  deriveWorkbenchProjectTabStorage,
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

test("account project tabs are cloud across cached, newly opened and active-session tabs, while a linked file keeps its identity", () => {
  const accountProject: ProjectManifest = {
    ...project,
    service: { orgId: "org", projectId: "remote" },
  };
  const local: WorkbenchTabsState = {
    tabs: [
      first,
      { ...second, storageKind: "filesystem", storageDescriptor: "lid.cadara" },
    ],
    activeDocumentId: first.documentId,
  };
  const restored = deriveWorkbenchProjectTabStorage(
    accountProject,
    createWorkbenchProjectTabs(accountProject, local, local),
  );
  expect(restored.tabs.map((tab) => tab.storageKind)).toEqual([
    "cloud",
    "filesystem",
  ]);
  expect(restored.tabs[1]?.storageDescriptor).toBe("lid.cadara");
  const sessionUpdate = reduceWorkbenchTabs(restored, {
    type: "syncActive",
    tab: first,
  });
  expect(
    deriveWorkbenchProjectTabStorage(accountProject, sessionUpdate).tabs[0]
      ?.storageKind,
  ).toBe("cloud");
  const opened = reduceWorkbenchTabs(restored, {
    type: "open",
    tab: { ...first, documentId: "doc_new" },
  });
  expect(
    deriveWorkbenchProjectTabStorage(accountProject, opened).tabs.map(
      (tab) => tab.storageKind,
    ),
  ).toEqual(["cloud", "filesystem", "cloud"]);
  expect(deriveWorkbenchProjectTabStorage(project, local)).toBe(local);
  expect(deriveWorkbenchProjectTabStorage(accountProject, restored)).toBe(
    restored,
  );
});

test("a Local project's tab cache cannot keep stale cloud storage, while linked files keep their file identity", () => {
  const local: WorkbenchTabsState = {
    tabs: [
      {
        ...first,
        storageKind: "cloud",
        storageDescriptor: "Old account project",
      },
      { ...second, storageKind: "filesystem", storageDescriptor: "Lid.cadara" },
    ],
    activeDocumentId: first.documentId,
  };
  expect(
    deriveWorkbenchProjectTabStorage(
      project,
      createWorkbenchProjectTabs(project, local, local),
    ).tabs.map((tab) => tab.storageKind),
  ).toEqual(["browser", "filesystem"]);
});
