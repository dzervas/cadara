import { getHeads } from "@automerge/automerge/slim";
import type {
  AutomergeUrl,
  StorageAdapterInterface,
} from "@automerge/automerge-repo/slim";
import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
} from "@automerge/automerge-repo/slim";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import type { DocumentId } from "@/contracts/shared/ids";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { ProjectCatalog } from "@/contracts/modeling/project-catalog.runtime-schema";
import { validateProjectCatalog } from "@/contracts/modeling/project-catalog.runtime-schema";
import type {
  ProjectManifest,
  ProjectEntry,
  ProjectResult,
  ProjectServiceLink,
  ProjectReadmeDocument,
  ProjectDiscussionDocument,
} from "@/contracts/modeling/project-manifest";
import {
  parseProjectManifest,
  validateLegacyProjectManifest,
} from "@/contracts/modeling/project-manifest.runtime-schema";
import type { AutomergeHandleLike } from "./indexeddb-automerge-document-repository";
import { IndexedDbAutomergeDocumentRepository } from "./indexeddb-automerge-document-repository";
import type { DocumentRepositoryUrlStore } from "./document-repository-url-store";
import { isDocumentChunk } from "./automerge-chunk-key-recorder";
import { OCC_KERNEL_DOCUMENT_ID } from "@/core/modeling/opencascade-kernel-seed";
import type { CollaborativeDocument } from "@/core/modeling/collaborative-document";

const CATALOG_ID = "doc_project_catalog" as DocumentId;

interface ProjectPartEdits {
  removed: ReadonlySet<string>;
  renamed: ReadonlyMap<string, string>;
  added: readonly ProjectEntry[];
  /** The part entries' docIds in their wanted order, when it applies. */
  order: readonly string[] | null;
}

/**
 * Edits part entries in place, on a plain manifest or inside an Automerge
 * change: entries are spliced and renamed individually, never replaced as a
 * whole list, so concurrent edits to other entries merge.
 */
function applyProjectPartEdits(
  entries: ProjectEntry[],
  { removed, renamed, added, order }: ProjectPartEdits,
) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind === "part" && removed.has(entry.docId))
      entries.splice(index, 1);
  }
  for (const entry of entries) {
    const name = renamed.get(entry.docId);
    if (entry.kind === "part" && name !== undefined && entry.name !== name)
      entry.name = name;
  }
  for (const entry of added) {
    let after = -1;
    entries.forEach((current, index) => {
      if (current.kind === "part") after = index;
    });
    entries.splice(after + 1, 0, { ...entry });
  }
  if (!order) return;
  const slots: number[] = [];
  entries.forEach((entry, index) => {
    if (entry.kind === "part") slots.push(index);
  });
  order.forEach((docId, position) => {
    const slot = slots[position]!;
    const index = entries.findIndex(
      (entry) => entry.kind === "part" && entry.docId === docId,
    );
    if (index === slot) return;
    const moved = JSON.parse(JSON.stringify(entries[index])) as ProjectEntry;
    entries.splice(index, 1);
    entries.splice(slot, 0, moved);
  });
}

/** The Automerge documents whose changes the storage holds (sync states aside). */
export async function listStoredAutomergeDocumentIds(
  storage: Pick<StorageAdapterInterface, "loadRange">,
) {
  const ids = new Set<string>();
  for (const { key } of await storage.loadRange([]))
    if (isDocumentChunk(key)) ids.add(key[0]!);
  return [...ids];
}

/** The Automerge documents stored in one IndexedDB document database. */
export function listIndexedDbAutomergeDocumentIds(databaseName: string) {
  return listStoredAutomergeDocumentIds(
    new IndexedDBStorageAdapter(databaseName, "documents"),
  );
}

/** Manifests reference part identities; linking or removing an entry never rewrites its part. */
export class LocalProjectRepository {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly documents: IndexedDbAutomergeDocumentRepository;
  private readonly urls: DocumentRepositoryUrlStore;
  private readonly catalogUrls: DocumentRepositoryUrlStore;
  private readonly ensurePartReady?: (docId: DocumentId) => Promise<void>;
  /** The documents in the repository's storage; repairCatalog scans them. */
  private readonly listStoredDocumentIds?: () => Promise<readonly string[]>;
  constructor(
    documents: IndexedDbAutomergeDocumentRepository,
    urls: DocumentRepositoryUrlStore,
    catalogUrls: DocumentRepositoryUrlStore = urls,
    ensurePartReady?: (docId: DocumentId) => Promise<void>,
    listStoredDocumentIds?: () => Promise<readonly string[]>,
  ) {
    this.documents = documents;
    this.urls = urls;
    this.catalogUrls = catalogUrls;
    this.ensurePartReady = ensurePartReady;
    this.listStoredDocumentIds = listStoredDocumentIds;
  }

  private run<T>(operation: () => Promise<T>): Promise<ProjectResult<T>> {
    const next = this.queue.then(async (): Promise<ProjectResult<T>> => {
      try {
        return { ok: true, value: await operation() };
      } catch (error) {
        return {
          ok: false,
          diagnostic: {
            reasonCode: "project-persistence-failed",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    });
    this.queue = next;
    return next;
  }

  private async catalog() {
    const repo = await this.documents.getAutomergeRepository();
    const url = this.catalogUrls.get(CATALOG_ID);
    const handle = url
      ? await repo.find<ProjectCatalog>(url)
      : repo.create<ProjectCatalog>({
          format: "cadara-project-catalog",
          schemaVersion: 1,
          projects: [],
        });
    await handle.whenReady();
    const parsed = validateProjectCatalog(handle.doc());
    if (
      !parsed.success ||
      parsed.data.projects.some(
        (project) =>
          !project.projectId.trim() || !isValidAutomergeUrl(project.url),
      )
    )
      throw new Error("Invalid local project catalog.");
    if (!url) {
      await repo.flush?.([handle.documentId]);
      this.catalogUrls.set(CATALOG_ID, handle.url);
    }
    return handle;
  }

  private checked(handle: AutomergeHandleLike<ProjectManifest>) {
    const result = parseProjectManifest(handle.doc());
    if (!result.ok) throw new Error(result.diagnostic.message);
    return JSON.parse(JSON.stringify(result.value)) as ProjectManifest;
  }

  /**
   * The Automerge identity is part of the stored URL. A local peer's
   * document (URL shared, data only in the peer's storage and the sync
   * worker) is not loadable here, so it is never loaded for its identity.
   */
  private storedDocumentId(docId: DocumentId) {
    const url = this.urls.get(docId);
    if (!url) throw new Error(`Document ${docId} has no stored Automerge URL.`);
    return parseAutomergeUrl(url).documentId;
  }

  private async partEntry(entry: {
    name: string;
    docId: DocumentId;
  }): Promise<ProjectEntry> {
    if (!entry.name.trim() || !entry.docId.trim())
      throw new Error("Project entries require names and document identities.");
    // The workbench's document owner initializes unsaved tabs; a second repository must not seed them.
    if (!this.urls.get(entry.docId)) await this.ensurePartReady?.(entry.docId);
    return {
      ...entry,
      kind: "part",
      automergeDocumentId: this.storedDocumentId(entry.docId),
    };
  }

  /**
   * The manifest with legacy entries' missing identities (from before
   * manifests recorded them) filled from their stored URLs, and the indices
   * of the filled entries.
   */
  private migration(
    value: unknown,
  ): ProjectResult<{ manifest: ProjectManifest; filled: number[] }> {
    const failed = (message: string) => ({
      ok: false as const,
      diagnostic: { reasonCode: "invalid-project-manifest", message },
    });
    const legacy = validateLegacyProjectManifest(value);
    if (!legacy.success) return failed("Invalid project manifest.");
    const next = JSON.parse(JSON.stringify(legacy.data)) as ProjectManifest;
    const filled: number[] = [];
    for (const [index, entry] of next.entries.entries()) {
      if (entry.automergeDocumentId !== undefined) continue;
      const url = this.urls.get(entry.docId);
      if (!url)
        return failed(`Document ${entry.docId} has no stored Automerge URL.`);
      entry.automergeDocumentId = parseAutomergeUrl(url).documentId;
      filled.push(index);
    }
    const parsed = parseProjectManifest(next);
    return parsed.ok
      ? { ok: true, value: { manifest: parsed.value, filled } }
      : parsed;
  }

  private async migrate(handle: AutomergeHandleLike<ProjectManifest>) {
    const migration = this.migration(handle.doc());
    if (!migration.ok) throw new Error(migration.diagnostic.message);
    const { manifest, filled } = migration.value;
    if (!filled.length) return;
    handle.change((draft) => {
      for (const index of filled)
        draft.entries[index].automergeDocumentId =
          manifest.entries[index].automergeDocumentId;
    });
    await (
      await this.documents.getAutomergeRepository()
    ).flush?.([handle.documentId]);
  }

  private async handle(projectId: string) {
    const catalog = await this.catalog();
    const entry = catalog
      .doc()
      .projects.find((project) => project.projectId === projectId);
    if (!entry) throw new Error("Project not found in this browser.");
    const handle = await (
      await this.documents.getAutomergeRepository()
    ).find<ProjectManifest>(entry.url as AutomergeUrl);
    await handle.whenReady();
    await this.migrate(handle);
    if (this.checked(handle).projectId !== projectId)
      throw new Error("Project identity does not match its catalog entry.");
    return handle;
  }

  list() {
    return this.run(async () => {
      const catalog = await this.catalog();
      const projects: ProjectManifest[] = [];
      for (const entry of catalog.doc().projects)
        projects.push(this.checked(await this.handle(entry.projectId)));
      return projects;
    });
  }

  create(
    name: string,
    entries: Omit<ProjectEntry, "automergeDocumentId">[],
    forkedFrom?: ProjectManifest["forkedFrom"],
  ) {
    return this.run(async () => {
      if (entries.some((entry) => entry.kind === "assembly"))
        throw new Error("Assembly documents are not implemented.");
      const manifest: ProjectManifest = {
        format: "cadara-project",
        schemaVersion: 1,
        projectId: crypto.randomUUID(),
        name,
        entries: await Promise.all(
          entries.map(async (entry) =>
            entry.kind === "part"
              ? this.partEntry(entry)
              : {
                  ...entry,
                  automergeDocumentId: this.storedDocumentId(entry.docId),
                },
          ),
        ),
        versions: [],
        ...(forkedFrom ? { forkedFrom } : {}),
      };
      const parsed = parseProjectManifest(manifest);
      if (!parsed.ok) throw new Error(parsed.diagnostic.message);
      const repo = await this.documents.getAutomergeRepository();
      const catalog = await this.catalog();
      const handle = repo.create(manifest);
      await handle.whenReady();
      await repo.flush?.([handle.documentId]);
      catalog.change((draft) => {
        draft.projects.push({ projectId: manifest.projectId, url: handle.url });
      });
      await repo.flush?.([catalog.documentId]);
      return this.checked(handle);
    });
  }

  open(projectId: string) {
    return this.run(async () => this.checked(await this.handle(projectId)));
  }

  private async edit(
    projectId: string,
    change: (draft: ProjectManifest) => void,
  ) {
    const handle = await this.handle(projectId);
    const next = this.checked(handle);
    change(next);
    return this.write(handle, next);
  }

  private async write(
    handle: AutomergeHandleLike<ProjectManifest>,
    next: ProjectManifest,
  ) {
    const parsed = parseProjectManifest(next);
    if (!parsed.ok) throw new Error(parsed.diagnostic.message);
    const current = this.checked(handle);
    const changed = Object.fromEntries(
      Object.entries(parsed.value).filter(
        ([key, value]) =>
          JSON.stringify(current[key as keyof ProjectManifest]) !==
          JSON.stringify(value),
      ),
    );
    // Only plain values from the immutable snapshot cross into the change proxy.
    handle.change((draft) => {
      Object.assign(draft, changed);
    });
    await (
      await this.documents.getAutomergeRepository()
    ).flush?.([handle.documentId]);
    return this.checked(handle);
  }

  addPart(
    projectId: string,
    entry: { name: string; docId: DocumentId },
    seed?: AuthoredModelDocument,
  ) {
    return this.run(async () => {
      const handle = await this.handle(projectId);
      const next = this.checked(handle);
      if (
        !entry.name.trim() ||
        !entry.docId.trim() ||
        next.entries.some((current) => current.docId === entry.docId)
      )
        throw new Error(
          "Project entries require names and unique document identities.",
        );
      if (seed) {
        if (this.urls.get(entry.docId))
          throw new Error(
            "This part document already exists; link it without a seed.",
          );
        const initialized = await this.documents.initialize({
          documentId: entry.docId,
          document: seed,
        });
        if (!initialized.ok)
          throw new Error(initialized.status.diagnostic.message);
      }
      next.entries.push(await this.partEntry(entry));
      return this.write(handle, next);
    });
  }

  addReadme(projectId: string, name = "Readme", markdown = "") {
    return this.run(async () => {
      const repo = await this.documents.getAutomergeRepository();
      const handle = repo.create<ProjectReadmeDocument>({
        format: "cadara-readme",
        schemaVersion: 1,
        markdown,
      });
      await handle.whenReady();
      await repo.flush?.([handle.documentId]);
      const docId = `doc_${handle.documentId}` as DocumentId;
      this.urls.set(docId, handle.url);
      return this.edit(projectId, (draft) => {
        draft.entries.push({
          name,
          kind: "readme",
          docId,
          automergeDocumentId: handle.documentId,
        });
      });
    });
  }

  ensureDiscussion(projectId: string) {
    return this.run(async () => {
      const manifest = this.checked(await this.handle(projectId));
      if (manifest.entries.some((entry) => entry.kind === "discussion"))
        return manifest;
      const repo = await this.documents.getAutomergeRepository();
      const handle = repo.create<ProjectDiscussionDocument>({
        format: "cadara-discussion",
        schemaVersion: 1,
        annotations: {},
      });
      await handle.whenReady();
      await repo.flush?.([handle.documentId]);
      const docId = `doc_${handle.documentId}` as DocumentId;
      this.urls.set(docId, handle.url);
      return this.edit(projectId, (draft) => {
        draft.entries.push({
          name: "Discussion",
          kind: "discussion",
          docId,
          automergeDocumentId: handle.documentId,
        });
      });
    });
  }

  renameEntry(projectId: string, docId: DocumentId, name: string) {
    return this.run(() =>
      this.edit(projectId, (draft) => {
        const entry = draft.entries.find((entry) => entry.docId === docId);
        if (!entry) throw new Error("Project entry not found.");
        entry.name = name;
      }),
    );
  }

  /**
   * Applies a change of the workbench's part tabs to the manifest as entry
   * edits, so edits collaborators made meanwhile survive. Parts in
   * `previous` but not in `parts` are removed, parts in neither the
   * baseline nor the manifest are added, renamed parts are renamed, and the
   * local tab order is kept while no collaborator's part is missing from
   * it. Without `previous` the manifest's current parts are the baseline.
   */
  setParts(
    projectId: string,
    parts: { docId: DocumentId; name: string }[],
    previous?: { docId: DocumentId; name: string }[],
  ) {
    return this.run(async () => {
      const handle = await this.handle(projectId);
      const current = this.checked(handle);
      const isPart = (entry: ProjectEntry) => entry.kind === "part";
      const baseline =
        previous ??
        current.entries
          .filter(isPart)
          .map(({ docId, name }) => ({ docId, name }));
      const wanted = new Set(parts.map((part) => part.docId));
      const baselineNames = new Map(
        baseline.map((part) => [part.docId, part.name]),
      );
      const listed = new Set(
        current.entries.filter(isPart).map((e) => e.docId),
      );
      const added: ProjectEntry[] = [];
      for (const part of parts)
        if (!baselineNames.has(part.docId) && !listed.has(part.docId))
          added.push(await this.partEntry(part));
      const edits: ProjectPartEdits = {
        removed: new Set(
          baseline
            .filter((part) => !wanted.has(part.docId))
            .map((part) => part.docId),
        ),
        renamed: new Map(
          parts
            .filter(
              (part) =>
                baselineNames.has(part.docId) &&
                baselineNames.get(part.docId) !== part.name,
            )
            .map((part) => [part.docId, part.name]),
        ),
        added,
        order: null,
      };
      const next = JSON.parse(JSON.stringify(current)) as ProjectManifest;
      applyProjectPartEdits(next.entries, edits);
      const nextParts = next.entries.filter(isPart).map((e) => e.docId);
      if (
        nextParts.length === parts.length &&
        nextParts.every((docId) => wanted.has(docId))
      ) {
        edits.order = parts.map((part) => part.docId);
        applyProjectPartEdits(next.entries, {
          removed: new Set(),
          renamed: new Map(),
          added: [],
          order: edits.order,
        });
      }
      const parsed = parseProjectManifest(next);
      if (!parsed.ok) throw new Error(parsed.diagnostic.message);
      if (JSON.stringify(next) === JSON.stringify(current)) return current;
      handle.change((draft) => {
        applyProjectPartEdits(draft.entries, edits);
      });
      await (
        await this.documents.getAutomergeRepository()
      ).flush?.([handle.documentId]);
      return this.checked(handle);
    });
  }

  /**
   * Follows the project's manifest, including collaborators' changes, and
   * records the Automerge URLs of entries this browser has not seen yet.
   */
  async subscribe(
    projectId: string,
    listener: (manifest: ProjectManifest) => void,
  ) {
    const opened = await this.run(() => this.handle(projectId));
    if (!opened.ok) throw new Error(opened.diagnostic.message);
    const handle = opened.value;
    const changed = () => {
      const parsed = parseProjectManifest(handle.doc());
      if (!parsed.ok) return;
      const manifest = JSON.parse(
        JSON.stringify(parsed.value),
      ) as ProjectManifest;
      this.mapEntryUrls(manifest, "skip");
      listener(manifest);
    };
    handle.on("change", changed);
    return () => handle.off?.("change", changed);
  }

  /** Whether this browser maps no entry of the manifest to another document. */
  private entryUrlsAgree(manifest: ProjectManifest) {
    return manifest.entries.every((entry) => {
      const entryUrl = `automerge:${entry.automergeDocumentId}`;
      const known = this.urls.get(entry.docId);
      return isValidAutomergeUrl(entryUrl) && (!known || known === entryUrl);
    });
  }

  private mapEntryUrls(manifest: ProjectManifest, conflict: "throw" | "skip") {
    for (const entry of manifest.entries) {
      const entryUrl = `automerge:${entry.automergeDocumentId}`;
      if (!isValidAutomergeUrl(entryUrl)) {
        if (conflict === "throw")
          throw new Error(`Invalid document identity for ${entry.name}.`);
        continue;
      }
      const known = this.urls.get(entry.docId);
      if (known && known !== entryUrl) {
        if (conflict === "throw")
          throw new Error(
            // Only parts that kept the legacy first-part id can collide.
            entry.docId === OCC_KERNEL_DOCUMENT_ID
              ? `${entry.name} uses the legacy first-part identity, and this browser already holds a different document under it. Open the project from a new browser profile.`
              : `${entry.name} is already stored in this browser as another document.`,
          );
        continue;
      }
      if (!known) this.urls.set(entry.docId, entryUrl);
    }
  }

  /**
   * Automerge ids of this browser's catalog, of other projects' manifests
   * and of their documents, minus the documents the given manifest lists.
   */
  foreignDocumentIds(manifestDocumentId: string) {
    return this.run(async () => {
      const catalog = await this.catalog();
      const ids = new Set<string>([catalog.documentId]);
      const own = new Set<string>([manifestDocumentId]);
      for (const project of catalog.doc().projects) {
        const handle = await this.handle(project.projectId);
        const entries = this.checked(handle).entries.map(
          (entry) => entry.automergeDocumentId,
        );
        const target = handle.documentId === manifestDocumentId ? own : ids;
        target.add(handle.documentId);
        for (const id of entries) target.add(id);
      }
      return [...ids].filter((id) => !own.has(id));
    });
  }

  /** The Automerge document id of the project's manifest. */
  manifestDocumentId(projectId: string) {
    return this.run(async () => (await this.handle(projectId)).documentId);
  }

  linkService(projectId: string, service: ProjectServiceLink) {
    return this.run(() =>
      this.edit(projectId, (draft) => {
        draft.service = service;
      }),
    );
  }

  /**
   * Adds a manifest that arrived through project sync to this browser's
   * catalog and records its entries' Automerge URLs, so its parts open
   * from the synced documents rather than as new ones.
   */
  adoptManifest(automergeDocumentId: string) {
    return this.run(async () => {
      const url = `automerge:${automergeDocumentId}` as AutomergeUrl;
      if (!isValidAutomergeUrl(url))
        throw new Error("Invalid manifest document identity.");
      const repo = await this.documents.getAutomergeRepository();
      const handle = await repo.find<ProjectManifest>(url);
      await handle.whenReady();
      const manifest = this.checked(handle);
      this.mapEntryUrls(manifest, "throw");
      const catalog = await this.catalog();
      if (
        !catalog
          .doc()
          .projects.some((project) => project.projectId === manifest.projectId)
      ) {
        catalog.change((draft) => {
          draft.projects.push({ projectId: manifest.projectId, url });
        });
        await repo.flush?.([catalog.documentId]);
      }
      return manifest;
    });
  }

  /**
   * Rebuilds this browser's project catalog from the manifests in its
   * storage, for a catalog or manifest that no longer opens, and returns how
   * many stored documents it left out. A manifest is listed once per project
   * when it parses after legacy migration and this browser maps none of its
   * entries to another document (adoptManifest's refusal); its unmapped
   * entries are mapped as adoption would. Stored parts (their URL is this
   * browser's URL for their identity) that no listed project contains join
   * one new project, "Recovered parts". The scan changes no stored
   * document: the previous catalog stays in storage, and only the stored
   * catalog URL moves.
   */
  repairCatalog() {
    return this.run(async () => {
      if (!this.listStoredDocumentIds)
        throw new Error("This browser's stored documents cannot be listed.");
      const repo = await this.documents.getAutomergeRepository();
      const projects: ProjectCatalog["projects"] = [];
      const listed = new Set<string>();
      const parts: ProjectEntry[] = [];
      let leftOut = 0;
      for (const id of await this.listStoredDocumentIds()) {
        const url = `automerge:${id}`;
        if (!isValidAutomergeUrl(url)) continue;
        let stored: {
          format?: unknown;
          authored?: { documentId?: unknown; name?: unknown };
        };
        try {
          const handle = await repo.find<typeof stored>(url);
          await handle.whenReady();
          stored = handle.doc();
        } catch {
          // A damaged document must not stop the repair; the caller reports the count.
          leftOut += 1;
          continue;
        }
        if (stored.format === "cadara-project") {
          const migration = this.migration(stored);
          if (!migration.ok || !this.entryUrlsAgree(migration.value.manifest)) {
            leftOut += 1;
            continue;
          }
          const { manifest } = migration.value;
          if (
            projects.some((project) => project.projectId === manifest.projectId)
          )
            continue;
          this.mapEntryUrls(manifest, "skip");
          projects.push({ projectId: manifest.projectId, url });
          for (const entry of manifest.entries)
            listed.add(entry.automergeDocumentId);
        } else if (
          stored.format ===
            ("cadara-stable-authored-v3" satisfies CollaborativeDocument["format"]) &&
          typeof stored.authored?.documentId === "string" &&
          this.urls.get(stored.authored.documentId as DocumentId) === url
        ) {
          const name = stored.authored.name;
          parts.push({
            kind: "part",
            name: typeof name === "string" && name.trim() ? name : "Part",
            docId: stored.authored.documentId as DocumentId,
            automergeDocumentId: id,
          });
        }
      }
      const unlisted = parts.filter(
        (part) => !listed.has(part.automergeDocumentId),
      );
      if (unlisted.length) {
        const parsed = parseProjectManifest({
          format: "cadara-project",
          schemaVersion: 1,
          projectId: crypto.randomUUID(),
          name: "Recovered parts",
          entries: unlisted,
          versions: [],
        } satisfies ProjectManifest);
        if (!parsed.ok) throw new Error(parsed.diagnostic.message);
        const recovered = repo.create(parsed.value);
        await recovered.whenReady();
        await repo.flush?.([recovered.documentId]);
        projects.push({
          projectId: parsed.value.projectId,
          url: recovered.url,
        });
      }
      const catalog = repo.create<ProjectCatalog>({
        format: "cadara-project-catalog",
        schemaVersion: 1,
        projects,
      });
      await catalog.whenReady();
      await repo.flush?.([catalog.documentId]);
      this.catalogUrls.set(CATALOG_ID, catalog.url);
      return { leftOut };
    });
  }

  recordVersion(
    projectId: string,
    label: string,
    createdAt = new Date().toISOString(),
  ) {
    return this.run(async () => {
      const manifest = this.checked(await this.handle(projectId));
      const repo = await this.documents.getAutomergeRepository();
      const heads: Record<string, string[]> = {};
      for (const entry of manifest.entries) {
        const url = this.urls.get(entry.docId);
        if (!url)
          throw new Error(`Document ${entry.name} has not been saved yet.`);
        const handle = await repo.find<Record<string, unknown>>(url);
        await handle.whenReady();
        await repo.flush?.([handle.documentId]);
        heads[entry.docId] = getHeads(handle.doc());
      }
      return this.edit(projectId, (draft) => {
        draft.versions.push({ label, createdAt, heads });
      });
    });
  }
}
