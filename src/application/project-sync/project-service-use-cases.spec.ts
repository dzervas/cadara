import { expect, test } from "vitest";
import type {
  ProjectManifest,
  ProjectServiceLink,
} from "@/contracts/modeling/project-manifest";
import type { RemoteProject } from "@/contracts/project-sync/project-service";
import type {
  ProjectServicePort,
  ProjectSyncTransport,
  SyncedProjectStore,
} from "./project-service-port";
import { ProjectSlugConflictError } from "./project-service-port";
import {
  openServiceProject,
  presenceDisplayName,
  startProjectSync,
  projectSlugFromName,
  uploadProjectToService,
} from "./project-service-use-cases";

function makeManifest(
  overrides: Partial<ProjectManifest> = {},
): ProjectManifest {
  return {
    format: "cadara-project",
    schemaVersion: 1,
    projectId: "local_project",
    name: "Bracket",
    entries: [],
    versions: [],
    ...overrides,
  };
}

function makeRemote(overrides: Partial<RemoteProject> = {}): RemoteProject {
  return {
    id: "remote_project",
    organization_id: "org_one",
    slug: "bracket",
    name: "Bracket",
    visibility: "private",
    manifest_doc_id: "manifest_doc",
    ...overrides,
  };
}

function makeFakes() {
  const calls: string[] = [];
  let manifest = makeManifest();
  const service: ProjectServicePort = {
    async createProject(orgId, input) {
      calls.push(`create ${orgId} ${input.slug} ${input.visibility}`);
      return makeRemote({ organization_id: orgId, slug: input.slug });
    },
    async registerManifest(link, id) {
      calls.push(`register ${link.projectId} ${id}`);
    },
    async listProjects() {
      return [];
    },
    async issueSyncGrant() {
      return { token: "t", expiresIn: 600, role: "editor" };
    },
  };
  const projects: SyncedProjectStore = {
    async manifestDocumentId(projectId) {
      calls.push(`manifest id ${projectId}`);
      return "manifest_doc";
    },
    async linkService(projectId, link) {
      calls.push(`link ${projectId} ${link.orgId}/${link.projectId}`);
      manifest = { ...manifest, service: link };
      return manifest;
    },
    async adoptManifest(id) {
      calls.push(`adopt ${id}`);
      return makeManifest({
        service: { orgId: "org_one", projectId: "remote_project" },
      });
    },
    async foreignDocumentIds() {
      return ["other_project_doc"];
    },
  };
  let manifestArrives: Promise<void> = Promise.resolve();
  // Like the worker transport: each start is released by one stop.
  const holders = new Map<string, number>();
  const transport: ProjectSyncTransport & { arrive(p: Promise<void>): void } = {
    arrive(promise) {
      manifestArrives = promise;
    },
    start({ link, manifestDocumentId, foreignDocumentIds }) {
      const held = holders.get(link.projectId) ?? 0;
      holders.set(link.projectId, held + 1);
      if (!held)
        calls.push(
          `start ${link.projectId} ${manifestDocumentId} without ${foreignDocumentIds.join()}`,
        );
    },
    stop(link: ProjectServiceLink) {
      const held = (holders.get(link.projectId) ?? 0) - 1;
      holders.set(link.projectId, held);
      if (!held) calls.push(`stop ${link.projectId}`);
    },
    whenSynced: () => manifestArrives,
    setPresence() {},
    subscribe: () => () => undefined,
  };
  return { calls, service, projects, transport };
}

test("upload creates the service project, registers the existing manifest document, then links it", async () => {
  const fakes = makeFakes();
  const linked = await uploadProjectToService(fakes, {
    manifest: makeManifest(),
    orgId: "org_one",
    name: "Bracket",
    slug: "bracket",
    visibility: "public",
  });
  expect(fakes.calls).toEqual([
    "manifest id local_project",
    "create org_one bracket public",
    "register remote_project manifest_doc",
    "link local_project org_one/remote_project",
  ]);
  expect(linked.service).toEqual({
    orgId: "org_one",
    projectId: "remote_project",
  });
});

test("a failed registration leaves the local project unlinked", async () => {
  const fakes = makeFakes();
  fakes.service.registerManifest = async () => {
    throw new Error("manifest_conflict");
  };
  await expect(
    uploadProjectToService(fakes, {
      manifest: makeManifest(),
      orgId: "org_one",
      name: "Bracket",
      slug: "bracket",
      visibility: "private",
    }),
  ).rejects.toThrow("manifest_conflict");
  expect(fakes.calls.some((call) => call.startsWith("link"))).toBe(false);
});

test("an already linked project is not uploaded twice", async () => {
  const fakes = makeFakes();
  await expect(
    uploadProjectToService(fakes, {
      manifest: makeManifest({ service: { orgId: "o", projectId: "p" } }),
      orgId: "org_one",
      name: "Bracket",
      slug: "bracket",
      visibility: "private",
    }),
  ).rejects.toThrow("already syncs");
  expect(fakes.calls).toEqual([]);
});

test("opening a service project adopts its manifest only after the room delivered its documents", async () => {
  const fakes = makeFakes();
  let deliver = () => {};
  fakes.transport.arrive(new Promise<void>((resolve) => (deliver = resolve)));
  const opening = openServiceProject(fakes, makeRemote());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fakes.calls).toEqual([
    "start remote_project manifest_doc without other_project_doc",
  ]);
  deliver();
  const opened = await opening;
  expect(fakes.calls).toEqual([
    "start remote_project manifest_doc without other_project_doc",
    "adopt manifest_doc",
  ]);
  expect(opened.manifest.service?.projectId).toBe("remote_project");
  opened.release();
  expect(fakes.calls.at(-1)).toBe("stop remote_project");
});

test("a failed open stops the connection it started", async () => {
  const fakes = makeFakes();
  fakes.transport.arrive(Promise.reject(new Error("offline")));
  await expect(openServiceProject(fakes, makeRemote())).rejects.toThrow(
    "offline",
  );
  expect(fakes.calls).toEqual([
    "start remote_project manifest_doc without other_project_doc",
    "stop remote_project",
  ]);
});

test("a failed open of the project that is already syncing leaves its connection running", async () => {
  const fakes = makeFakes();
  await startProjectSync(
    fakes,
    { orgId: "org_one", projectId: "remote_project" },
    "manifest_doc",
  );
  fakes.transport.arrive(Promise.reject(new Error("timed out")));
  await expect(openServiceProject(fakes, makeRemote())).rejects.toThrow(
    "timed out",
  );
  expect(fakes.calls.filter((call) => call.startsWith("stop"))).toEqual([]);
});

test("retrying an upload whose registration failed reuses the project the first attempt created", async () => {
  const fakes = makeFakes();
  fakes.service.createProject = async () => {
    fakes.calls.push("create refused: slug taken");
    throw new ProjectSlugConflictError();
  };
  fakes.service.listProjects = async () => [
    makeRemote({ id: "someone_else", slug: "bracket", name: "Other" }),
    makeRemote({ id: "orphan", slug: "bracket", manifest_doc_id: null }),
  ];
  const linked = await uploadProjectToService(fakes, {
    manifest: makeManifest(),
    orgId: "org_one",
    name: "Bracket",
    slug: "bracket",
    visibility: "private",
  });
  expect(fakes.calls).toContain("register orphan manifest_doc");
  expect(linked.service?.projectId).toBe("orphan");
});

test("a slug taken by a registered project is still refused", async () => {
  const fakes = makeFakes();
  fakes.service.createProject = async () => {
    throw new ProjectSlugConflictError();
  };
  fakes.service.listProjects = async () => [makeRemote({ slug: "bracket" })];
  await expect(
    uploadProjectToService(fakes, {
      manifest: makeManifest(),
      orgId: "org_one",
      name: "Bracket",
      slug: "bracket",
      visibility: "private",
    }),
  ).rejects.toBeInstanceOf(ProjectSlugConflictError);
});

test("projects without a registered manifest cannot be opened", async () => {
  await expect(
    openServiceProject(makeFakes(), makeRemote({ manifest_doc_id: null })),
  ).rejects.toThrow("no uploaded documents");
});

test("slugs follow the service rule", () => {
  expect(projectSlugFromName("  My Bracket v2!  ")).toBe("my-bracket-v2");
  expect(projectSlugFromName("Ωμέγα")).toBe("project");
  expect(projectSlugFromName("a".repeat(80))).toHaveLength(63);
});

test("presence shows the account name, or initials, but never the email address", () => {
  expect(presenceDisplayName({ name: " Ada ", email: "ada@x.test" })).toBe(
    "Ada",
  );
  expect(presenceDisplayName({ name: "", email: "grace.hopper@x.test" })).toBe(
    "GH",
  );
  expect(presenceDisplayName({ name: "", email: "@x.test" })).toBe("Guest");
});
