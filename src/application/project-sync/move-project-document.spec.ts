// Lane: logic. Seams: moveProjectDocument's step order and failure handling,
// and moveDocumentBetweenProjects' account wiring (grant check, the copy's
// Automerge id in the room wait, connection release, source confirmation),
// with the catalog, service and transport faked.
import { expect, test } from "vitest";
import type { ProjectRole } from "@/contracts/account/account";
import type {
  ProjectManifest,
  ProjectServiceLink,
} from "@/contracts/modeling/project-manifest";
import type { DocumentId } from "@/contracts/shared/ids";
import {
  MOVE_NOT_CONFIRMED_MESSAGE,
  moveDocumentBetweenProjects,
  moveProjectDocument,
  SOURCE_REMOVAL_NOT_CONFIRMED_MESSAGE,
  type MoveProjectDocumentSteps,
  type ProjectMoveStore,
} from "./move-project-document";
import type {
  ProjectServicePort,
  ProjectSyncTransport,
} from "./project-service-port";

function fakeSteps(failing?: keyof MoveProjectDocumentSteps): {
  steps: MoveProjectDocumentSteps;
  calls: string[];
} {
  const calls: string[] = [];
  const step =
    <T>(name: keyof MoveProjectDocumentSteps, value: T) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args].join(" "));
      if (name === failing) throw new Error(`${name} failed`);
      return value;
    };
  return {
    calls,
    steps: {
      waitForLocalChanges: step("waitForLocalChanges", undefined),
      checkAccess: step("checkAccess", undefined),
      cloneWithHistory: step("cloneWithHistory", "doc_copy" as DocumentId),
      addToTarget: step("addToTarget", undefined),
      confirmTarget: step("confirmTarget", undefined),
      removeFromSource: step("removeFromSource", undefined),
    },
  };
}

test("a move copies after pending edits and unlists the source only once the target holds the copy", async () => {
  const { steps, calls } = fakeSteps();
  await expect(moveProjectDocument(steps)).resolves.toBe("doc_copy");
  expect(calls).toEqual([
    "waitForLocalChanges",
    "checkAccess",
    "cloneWithHistory",
    "addToTarget doc_copy",
    "confirmTarget doc_copy",
    "removeFromSource",
  ]);
});

test.each([
  "waitForLocalChanges",
  "checkAccess",
  "cloneWithHistory",
  "addToTarget",
] as const)(
  "a failing %s keeps the source and reports why",
  async (failing) => {
    const { steps, calls } = fakeSteps(failing);
    await expect(moveProjectDocument(steps)).rejects.toThrow(
      `${failing} failed`,
    );
    expect(calls.some((call) => call.startsWith("removeFromSource"))).toBe(
      false,
    );
  },
);

test("an unconfirmed copy keeps the source and says the original was kept", async () => {
  const { steps, calls } = fakeSteps("confirmTarget");
  const moving = moveProjectDocument(steps);
  await expect(moving).rejects.toThrow(MOVE_NOT_CONFIRMED_MESSAGE);
  await expect(moving).rejects.toMatchObject({
    cause: new Error("confirmTarget failed"),
  });
  expect(calls.at(-1)).toBe("confirmTarget doc_copy");
});

function manifest(
  projectId: string,
  service?: ProjectManifest["service"],
  parts: string[] = [],
): ProjectManifest {
  return {
    format: "cadara-project",
    schemaVersion: 1,
    projectId,
    name: projectId,
    entries: parts.map((docId) => ({
      name: "Lid",
      kind: "part",
      docId: docId as DocumentId,
      automergeDocumentId: `am_${docId}`,
    })),
    versions: [],
    ...(service ? { service } : {}),
  };
}

const sourceLink = { orgId: "org", projectId: "remote_source" };
const targetLink = { orgId: "org", projectId: "remote_target" };

function fakeMove(options: {
  source?: ProjectManifest;
  target?: ProjectManifest;
  role?: ProjectRole;
  confirm?: (link: ProjectServiceLink, id?: string) => Promise<void>;
  listsCopy?: boolean;
}) {
  const calls: string[] = [];
  const source = options.source ?? manifest("source", undefined, ["doc_lid"]);
  const target = options.target ?? manifest("target", targetLink);
  const projects: ProjectMoveStore = {
    manifestDocumentId: async (projectId) => `manifest_${projectId}`,
    linkService: async () => target,
    adoptManifest: async () => target,
    foreignDocumentIds: async () => [],
    async addPart(projectId, entry) {
      calls.push(`add ${projectId} ${entry.docId}`);
      return options.listsCopy === false
        ? target
        : manifest(projectId, target.service, [entry.docId]);
    },
    async removePart(projectId, docId) {
      calls.push(`remove ${projectId} ${docId}`);
      return source;
    },
  };
  const service = {
    issueSyncGrant: async (link: ProjectServiceLink) => {
      calls.push(`grant ${link.projectId}`);
      return { token: "t", expiresIn: 600, role: options.role ?? "editor" };
    },
  } as unknown as ProjectServicePort;
  const transport = {
    start: ({ link }: { link: ProjectServiceLink }) =>
      calls.push(`start ${link.projectId}`),
    stop: (link: ProjectServiceLink) => calls.push(`stop ${link.projectId}`),
    whenSynced: async (link: ProjectServiceLink, id?: string) => {
      calls.push(`synced? ${link.projectId} ${id}`);
      await options.confirm?.(link, id);
    },
  } as unknown as ProjectSyncTransport;
  return {
    calls,
    move: () =>
      moveDocumentBetweenProjects({
        source,
        target,
        documentId: "doc_lid",
        projects,
        service,
        transport,
        createDocumentId: () => "doc_copy",
        waitForLocalChanges: async () => {
          calls.push("wait");
        },
        cloneWithHistory: async (from, to) => {
          calls.push(`clone ${from} ${to}`);
        },
      }),
  };
}

test("an account target is checked for editing, and its room must hold the copy's own Automerge document", async () => {
  const { calls, move } = fakeMove({});
  const moved = await move();
  expect(moved).toMatchObject({
    documentId: "doc_copy",
    sourceRemovalUnconfirmed: null,
  });
  expect(calls).toEqual([
    "wait",
    "grant remote_target",
    "clone doc_lid doc_copy",
    "add target doc_copy",
    "start remote_target",
    "synced? remote_target am_doc_copy",
    "remove source doc_lid",
  ]);
  moved.release();
  expect(calls.at(-1)).toBe("stop remote_target");
});

test("a viewer of the target cannot move into it and nothing is copied", async () => {
  const { calls, move } = fakeMove({ role: "viewer" });
  await expect(move()).rejects.toThrow("editor access");
  expect(calls.some((call) => call.startsWith("clone"))).toBe(false);
});

test("an unconfirmed copy releases the target connection and keeps the source", async () => {
  const { calls, move } = fakeMove({
    confirm: async () => {
      throw new Error("timed out");
    },
  });
  await expect(move()).rejects.toThrow(MOVE_NOT_CONFIRMED_MESSAGE);
  expect(calls.at(-1)).toBe("stop remote_target");
  expect(calls.some((call) => call.startsWith("remove"))).toBe(false);
});

test("a target that does not list the copy fails before any wait or removal", async () => {
  const { calls, move } = fakeMove({ listsCopy: false });
  await expect(move()).rejects.toThrow("did not list the copy");
  expect(calls.some((call) => call.startsWith("synced?"))).toBe(false);
  expect(calls.some((call) => call.startsWith("remove"))).toBe(false);
});

test("an account source waits for its room to hold the manifest without the part, and reports when it does not", async () => {
  const source = manifest("source", sourceLink, ["doc_lid"]);
  const target = manifest("target");
  const confirmed = fakeMove({ source, target });
  await expect(confirmed.move()).resolves.toMatchObject({
    sourceRemovalUnconfirmed: null,
  });
  expect(confirmed.calls.slice(-2)).toEqual([
    "remove source doc_lid",
    "synced? remote_source manifest_source",
  ]);

  const unconfirmed = fakeMove({
    source,
    target,
    confirm: async () => {
      throw new Error("timed out");
    },
  });
  const moved = await unconfirmed.move();
  expect(moved.documentId).toBe("doc_copy");
  expect(moved.sourceRemovalUnconfirmed?.message).toBe(
    SOURCE_REMOVAL_NOT_CONFIRMED_MESSAGE,
  );
});
