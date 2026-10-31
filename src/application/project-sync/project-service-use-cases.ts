import type { ProjectRole } from "@/contracts/account/account";
import type {
  ProjectManifest,
  ProjectServiceLink,
} from "@/contracts/modeling/project-manifest";
import type {
  ProjectVisibility,
  RemoteProject,
} from "@/contracts/project-sync/project-service";
import type {
  ProjectServicePort,
  ProjectSyncTransport,
  SyncedProjectStore,
} from "./project-service-port";

export interface ProjectServiceDependencies {
  service: ProjectServicePort;
  projects: SyncedProjectStore;
  transport: ProjectSyncTransport;
}

/**
 * Whether the user's role on a synced project lets them edit its parts;
 * the room rejects their part changes otherwise. Null: no role yet.
 */
export function canEditProjectParts(role: ProjectRole | null) {
  return role !== "viewer" && role !== "commenter";
}

/** The service's slug rule: 1-63 of `a-z`, `0-9` and `-`. */
export function projectSlugFromName(name: string) {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/, "");
  return slug || "project";
}

/**
 * Creates the service project, registers the local manifest as its
 * manifest document and records the link in the manifest. Document
 * identities are kept: the room syncs the existing Automerge documents.
 */
export async function uploadProjectToService(
  {
    service,
    projects,
  }: Pick<ProjectServiceDependencies, "service" | "projects">,
  input: {
    manifest: ProjectManifest;
    orgId: string;
    name: string;
    slug: string;
    visibility: ProjectVisibility;
  },
): Promise<ProjectManifest> {
  if (input.manifest.service)
    throw new Error("This project already syncs with CADara.");
  const manifestDocumentId = await projects.manifestDocumentId(
    input.manifest.projectId,
  );
  const remote = await service.createProject(input.orgId, {
    name: input.name,
    slug: input.slug,
    visibility: input.visibility,
  });
  const link = { orgId: remote.organization_id, projectId: remote.id };
  await service.registerManifest(link, manifestDocumentId);
  return projects.linkService(input.manifest.projectId, link);
}

/** Starts the live connection of a linked project. */
export function startProjectSync(
  {
    service,
    transport,
  }: Pick<ProjectServiceDependencies, "service" | "transport">,
  link: ProjectServiceLink,
  manifestDocumentId: string,
) {
  transport.start({
    link,
    manifestDocumentId,
    issueGrant: () => service.issueSyncGrant(link),
  });
  return () => transport.stop(link);
}

/**
 * Downloads a service project's documents through its room and adds its
 * manifest to the local catalog. The connection stays up for the caller to
 * keep syncing.
 */
export async function openServiceProject(
  dependencies: ProjectServiceDependencies,
  remote: RemoteProject,
): Promise<ProjectManifest> {
  if (!remote.manifest_doc_id)
    throw new Error("This project has no uploaded documents yet.");
  const link = { orgId: remote.organization_id, projectId: remote.id };
  const stop = startProjectSync(dependencies, link, remote.manifest_doc_id);
  try {
    await dependencies.transport.whenSynced(link);
    return await dependencies.projects.adoptManifest(remote.manifest_doc_id);
  } catch (error) {
    stop();
    throw error;
  }
}
