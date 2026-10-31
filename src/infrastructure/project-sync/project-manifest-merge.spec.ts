import { beforeAll, expect, test, vi } from "vitest";
import {
  initializeBase64Wasm,
  Repo,
  type AutomergeUrl,
} from "@automerge/automerge-repo/slim";
import { automergeWasmBase64 } from "@automerge/automerge/automerge.wasm.base64";
import type { ProjectResult } from "@/contracts/modeling/project-manifest";
import type { DocumentId } from "@/contracts/shared/ids";
import { createMemoryGeometryAssetStore } from "@/core/modeling/geometry-asset-store";
import { MemoryDocumentRepositoryUrlStore } from "@/infrastructure/persistence/document-repository-url-store";
import {
  IndexedDbAutomergeDocumentRepository,
  type AutomergeRepositoryLike,
} from "@/infrastructure/persistence/indexeddb-automerge-document-repository";
import { LocalProjectRepository } from "@/infrastructure/persistence/local-project-repository";
import { SharedMemoryStorage } from "@/infrastructure/persistence/shared-memory-automerge-storage.fixtures";
import { makeClient, makeRoom } from "./project-sync-room.fixtures";

beforeAll(async () => {
  await initializeBase64Wasm(automergeWasmBase64);
});

function unwrap<T>(result: ProjectResult<T>) {
  if (!result.ok) throw new Error(result.diagnostic.message);
  return result.value;
}

/** One browser: its Repo and its local project catalog over that Repo. */
function makeBrowser() {
  const repo = new Repo({ storage: new SharedMemoryStorage(), network: [] });
  const urls = new MemoryDocumentRepositoryUrlStore();
  const projects = new LocalProjectRepository(
    new IndexedDbAutomergeDocumentRepository({
      repo: repo as unknown as AutomergeRepositoryLike,
      urlStore: urls,
      assetStore: createMemoryGeometryAssetStore(),
    }),
    urls,
    new MemoryDocumentRepositoryUrlStore(),
  );
  /** A part document this browser created (a new tab). */
  const createPart = (docId: string, name: string) => {
    urls.set(
      docId as DocumentId,
      repo.create({ part: name }).url as AutomergeUrl,
    );
    return { docId: docId as DocumentId, name };
  };
  return { repo, projects, createPart };
}

test("two participants add parts while one is offline; after reconnecting and switching tabs both keep every part", async () => {
  const owner = makeBrowser();
  const base = owner.createPart("doc_base", "Base");
  const project = unwrap(
    await owner.projects.create("Bracket", [{ ...base, kind: "part" }]),
  );
  const manifestId = unwrap(
    await owner.projects.manifestDocumentId(project.projectId),
  );
  const room = makeRoom(manifestId);
  const ownerSync = makeClient(room, owner.repo);
  await ownerSync.start(manifestId);
  await vi.waitFor(
    () => expect(ownerSync.status()?.connection).toBe("synced"),
    { timeout: 5_000 },
  );

  const guest = makeBrowser();
  const guestSync = makeClient(room, guest.repo);
  await guestSync.start(manifestId);
  await vi.waitFor(
    () => expect(guestSync.status()?.connection).toBe("synced"),
    { timeout: 5_000 },
  );
  unwrap(await guest.projects.adoptManifest(manifestId));

  ownerSync.setOnline(false);
  await vi.waitFor(() =>
    expect(ownerSync.status()?.connection).toBe("offline"),
  );
  const hinge = owner.createPart("doc_hinge", "Hinge");
  unwrap(
    await owner.projects.setParts(project.projectId, [base, hinge], [base]),
  );
  const lid = guest.createPart("doc_lid", "Lid");
  unwrap(await guest.projects.setParts(project.projectId, [base, lid], [base]));
  // A tab switch on the guest saves its (unchanged) tabs again.
  unwrap(
    await guest.projects.setParts(project.projectId, [base, lid], [base, lid]),
  );

  ownerSync.setOnline(true);
  const partIds = async (browser: ReturnType<typeof makeBrowser>) =>
    unwrap(await browser.projects.open(project.projectId))
      .entries.map((entry) => entry.docId)
      .sort();
  const everyPart = ["doc_base", "doc_hinge", "doc_lid"];
  await vi.waitFor(
    async () => {
      expect(await partIds(owner)).toEqual(everyPart);
      expect(await partIds(guest)).toEqual(everyPart);
    },
    { timeout: 5_000 },
  );

  // The owner's tabs do not show the guest's part yet; switching tabs saves
  // them again without removing it.
  unwrap(
    await owner.projects.setParts(
      project.projectId,
      [base, hinge],
      [base, hinge],
    ),
  );
  await vi.waitFor(
    () => expect(ownerSync.status()?.connection).toBe("synced"),
    { timeout: 5_000 },
  );
  expect(await partIds(owner)).toEqual(everyPart);
  expect(await partIds(guest)).toEqual(everyPart);
  expect(room.network.violations).toEqual([]);
});
