import type { ProjectRole } from "@/contracts/account/account";
import type {
  ProjectManifest,
  ProjectServiceLink,
} from "@/contracts/modeling/project-manifest";
import type {
  ProjectPresencePeer,
  ProjectPresenceState,
  ProjectSyncConnection,
  ProjectSyncGrant,
  ProjectVisibility,
  RemoteProject,
} from "@/contracts/project-sync/project-service";

/** The CADara service's project endpoints, authenticated by the session cookie. */
export interface ProjectServicePort {
  createProject(
    orgId: string,
    input: { name: string; slug: string; visibility: ProjectVisibility },
  ): Promise<RemoteProject>;
  /** Registers the project's manifest document; the room serves nothing before. */
  registerManifest(
    link: ProjectServiceLink,
    automergeDocumentId: string,
  ): Promise<void>;
  listProjects(orgId: string): Promise<RemoteProject[]>;
  issueSyncGrant(link: ProjectServiceLink): Promise<ProjectSyncGrant>;
}

/** The local project catalog operations syncing needs. */
export interface SyncedProjectStore {
  /** The Automerge document id of a local project's manifest. */
  manifestDocumentId(projectId: string): Promise<string>;
  linkService(
    projectId: string,
    link: ProjectServiceLink,
  ): Promise<ProjectManifest>;
  /** Adds a manifest that arrived through sync to the local catalog. */
  adoptManifest(automergeDocumentId: string): Promise<ProjectManifest>;
}

export interface ProjectSyncStatus {
  connection: ProjectSyncConnection;
  /** The role of the latest sync token; null before the first one. */
  role: ProjectRole | null;
  peers: ProjectPresencePeer[];
  /** Why syncing could not start; the project keeps working locally. */
  error: string | null;
}

/** Runs the live connection of one project (the document sync worker). */
export interface ProjectSyncTransport {
  start(input: {
    link: ProjectServiceLink;
    manifestDocumentId: string;
    issueGrant: () => Promise<ProjectSyncGrant>;
  }): void;
  stop(link: ProjectServiceLink): void;
  /** Resolves once every project document matches the service's copy. */
  whenSynced(link: ProjectServiceLink): Promise<void>;
  setPresence(link: ProjectServiceLink, state: ProjectPresenceState): void;
  subscribe(
    link: ProjectServiceLink,
    listener: (status: ProjectSyncStatus) => void,
  ): () => void;
}
