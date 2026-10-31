import type { ProjectRole } from "@/contracts/account/account";

export type ProjectVisibility = "private" | "public";

/** The fields of a CADara service project record the client reads. */
export interface RemoteProject {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  visibility: ProjectVisibility;
  /** Null until the uploading client registers its manifest document. */
  manifest_doc_id: string | null;
}

/** POST /orgs/:orgId/projects/:projectId/sync-token. */
export interface SyncTokenResponse {
  token: string;
  /** Seconds until the room stops accepting the token. */
  expiresIn: number;
}

/** A sync token with the project role the room enforces for it. */
export interface ProjectSyncGrant extends SyncTokenResponse {
  role: ProjectRole;
}

/** The claims a sync token carries; the client reads only the role. */
export interface SyncTokenClaims {
  role: ProjectRole;
}

export type ProjectSyncConnection =
  /** No socket: signed out, unreachable or not started. Edits stay local. */
  | "offline"
  /** Fetching a token or opening the socket. */
  | "connecting"
  /** Connected; some project documents differ from the service's copy. */
  | "syncing"
  /** Connected and every project document matches the service's copy. */
  | "synced";

/** What each participant broadcasts about itself in a synced project. */
export interface ProjectPresenceState {
  userId: string;
  name: string;
  /** The part document the participant has open. */
  activeDocumentId: string | null;
}

export interface ProjectPresencePeer extends ProjectPresenceState {
  peerId: string;
}
