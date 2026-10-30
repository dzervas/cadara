import { getHeads } from "@automerge/automerge/slim";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { isValidAutomergeUrl } from "@automerge/automerge-repo/slim";
import type { DocumentId } from "@/contracts/shared/ids";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { ProjectCatalog } from "@/contracts/modeling/project-catalog.runtime-schema";
import { validateProjectCatalog } from "@/contracts/modeling/project-catalog.runtime-schema";
import type {
  ProjectManifest,
  ProjectEntry,
  ProjectResult,
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

const CATALOG_ID = "doc_project_catalog" as DocumentId;

/** Manifests reference part identities; linking or removing an entry never rewrites its part. */
export class LocalProjectRepository {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly documents: IndexedDbAutomergeDocumentRepository;
  private readonly urls: DocumentRepositoryUrlStore;
  private readonly catalogUrls: DocumentRepositoryUrlStore;
  private readonly ensurePartReady?: (docId: DocumentId) => Promise<void>;
  constructor(
    documents: IndexedDbAutomergeDocumentRepository,
    urls: DocumentRepositoryUrlStore,
    catalogUrls: DocumentRepositoryUrlStore = urls,
    ensurePartReady?: (docId: DocumentId) => Promise<void>,
  ) {
    this.documents = documents;
    this.urls = urls;
    this.catalogUrls = catalogUrls;
    this.ensurePartReady = ensurePartReady;
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

  private async resolveDocumentId(docId: DocumentId) {
    const url = this.urls.get(docId);
    if (!url) throw new Error(`Document ${docId} has no stored Automerge URL.`);
    const repo = await this.documents.getAutomergeRepository();
    const handle = await repo.find<Record<string, unknown>>(url);
    await handle.whenReady();
    return handle.documentId;
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
      automergeDocumentId: await this.resolveDocumentId(entry.docId),
    };
  }

  private async migrate(handle: AutomergeHandleLike<ProjectManifest>) {
    const legacy = validateLegacyProjectManifest(handle.doc());
    if (!legacy.success) throw new Error("Invalid project manifest.");
    if (
      !legacy.data.entries.some(
        (entry) => entry.automergeDocumentId === undefined,
      )
    )
      return;
    const originalEntries = JSON.stringify(legacy.data.entries);
    const next = JSON.parse(JSON.stringify(legacy.data)) as ProjectManifest;
    const assignments = next.entries.flatMap((entry, index) =>
      entry.automergeDocumentId === undefined ? [index] : [],
    );
    for (const entry of next.entries) {
      if (entry.automergeDocumentId === undefined)
        entry.automergeDocumentId = await this.resolveDocumentId(entry.docId);
    }
    const parsed = parseProjectManifest(next);
    if (!parsed.ok) throw new Error(parsed.diagnostic.message);
    if (JSON.stringify(handle.doc().entries) !== originalEntries)
      throw new Error(
        "Project entries changed while resolving document identities. Reopen the project to retry.",
      );
    handle.change((draft) => {
      for (const index of assignments)
        draft.entries[index].automergeDocumentId =
          next.entries[index].automergeDocumentId;
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
                  automergeDocumentId: await this.resolveDocumentId(
                    entry.docId,
                  ),
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

  /** Tab order/membership is authored in the manifest, not in a second tab index. */
  setParts(projectId: string, parts: { docId: DocumentId; name: string }[]) {
    return this.run(async () => {
      const handle = await this.handle(projectId);
      const next = this.checked(handle);
      const entries: ProjectEntry[] = [];
      for (const part of parts) {
        const existing = next.entries.find(
          (entry) => entry.kind === "part" && entry.docId === part.docId,
        );
        entries.push(
          existing
            ? { ...existing, name: part.name }
            : await this.partEntry(part),
        );
      }
      next.entries = [
        ...entries,
        ...next.entries.filter((entry) => entry.kind !== "part"),
      ];
      return this.write(handle, next);
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
