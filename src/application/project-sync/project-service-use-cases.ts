import type { ProjectRole } from "@/contracts/account/account";
import type {
  ProjectManifest,
  ProjectServiceLink,
} from "@/contracts/modeling/project-manifest";
import type {
  ProjectVisibility,
  RemoteProject,
} from "@/contracts/project-sync/project-service";
import {
  ProjectSlugConflictError,
  type ProjectServicePort,
  type ProjectSyncTransport,
  type SyncedProjectStore,
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

/**
 * What other participants see for this user: the account name, or initials
 * from the email's local part. The email address itself is never shared.
 */
export function presenceDisplayName(user: { name: string; email: string }) {
  if (user.name.trim()) return user.name.trim();
  const words = (user.email.split("@")[0] ?? "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => word[0]!.toUpperCase())
      .join("") || "Guest"
  );
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
 * A retry after a failed registration reuses the project the first attempt
 * created (same slug and name, no manifest yet) instead of failing on its
 * slug.
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
  let remote: RemoteProject;
  try {
    remote = await service.createProject(input.orgId, {
      name: input.name,
      slug: input.slug,
      visibility: input.visibility,
    });
  } catch (error) {
    if (!(error instanceof ProjectSlugConflictError)) throw error;
    const unregistered = (await service.listProjects(input.orgId)).find(
      (project) =>
        project.slug === input.slug &&
        project.name === input.name &&
        project.manifest_doc_id === null,
    );
    if (!unregistered) throw error;
    remote = unregistered;
  }
  const link = { orgId: remote.organization_id, projectId: remote.id };
  await service.registerManifest(link, manifestDocumentId);
  return projects.linkService(input.manifest.projectId, link);
}

/** Starts the live connection of a linked project; the result releases it. */
export async function startProjectSync(
  dependencies: ProjectServiceDependencies,
  link: ProjectServiceLink,
  manifestDocumentId: string,
) {
  const foreignDocumentIds =
    await dependencies.projects.foreignDocumentIds(manifestDocumentId);
  dependencies.transport.start({
    link,
    manifestDocumentId,
    foreignDocumentIds,
    issueGrant: () => dependencies.service.issueSyncGrant(link),
  });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    dependencies.transport.stop(link);
  };
}

/**
 * Downloads a service project's documents through its room and adds its
 * manifest to the local catalog. The caller releases this call's hold on
 * the connection once it has switched to the project (or failed to): an
 * already running connection, e.g. of the active project, is never stopped
 * by a failed open.
 */
export async function openServiceProject(
  dependencies: ProjectServiceDependencies,
  remote: RemoteProject,
): Promise<{ manifest: ProjectManifest; release: () => void }> {
  if (!remote.manifest_doc_id)
    throw new Error("This project has no uploaded documents yet.");
  const link = { orgId: remote.organization_id, projectId: remote.id };
  const release = await startProjectSync(
    dependencies,
    link,
    remote.manifest_doc_id,
  );
  try {
    await dependencies.transport.whenSynced(link);
    return {
      manifest: await dependencies.projects.adoptManifest(
        remote.manifest_doc_id,
      ),
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
