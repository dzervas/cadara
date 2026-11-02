import type { ProjectRole } from "./account";
import type { RemoteProject } from "@/contracts/project-sync/project-service";

/** GET /orgs/:orgId/projects/:projectId: the fields the project page reads. */
export interface ProjectDetails extends RemoteProject {
  /** Whether links handed out for the project still open it. */
  share_links_enabled: boolean;
  /** Milliseconds since the epoch. */
  updated_at: number;
}

export interface ProjectPersonIdentity {
  name: string;
  email: string;
  image: string | null;
}

/** Someone with an explicit role on the project. */
export interface ProjectGrantedPerson extends ProjectPersonIdentity {
  state: "granted";
  user_id: string;
  role: ProjectRole;
}

/** An invite sent to an email without a verified account yet. */
export interface ProjectPendingInvite {
  state: "pending";
  invite_id: string;
  email: string;
  role: ProjectRole;
  /** Milliseconds since the epoch; the invite stops working then. */
  expires_at: number;
}

/** GET /orgs/:orgId/projects/:projectId/people. */
export interface ProjectPeople {
  /** The caller's own role on the project. */
  your_role: ProjectRole | null;
  /** Whether the caller may invite, change roles and remove people. */
  can_manage: boolean;
  /** The owner of the project's organization; they have no grant row. */
  owner: (ProjectPersonIdentity & { user_id: string }) | null;
  organization: {
    personal: boolean;
    name: string;
    /** The role team members get on team projects; null for personal workspaces. */
    default_project_role: ProjectRole | null;
  };
  /**
   * Editors and admins besides the owner against the plan's per-project limit,
   * pending invites included. Null when the plan does not limit editors.
   */
  editors: { limit: number; used: number } | null;
  people: ProjectGrantedPerson[];
  /** Pending invites; only project admins see them. */
  pending: ProjectPendingInvite[];
}

/** POST …/invites: an existing account gets access now, an unknown email waits. */
export type ProjectInviteOutcome = ProjectGrantedPerson | ProjectPendingInvite;

/** GET …/versions: the fields a share link needs. */
export interface ProjectVersionSummary {
  id: string;
  /** Milliseconds since the epoch. */
  created_at: number;
  /** Only complete versions are published. */
  bundle_state: "pending" | "complete" | "purging";
  files: { name: string }[];
}

/** POST …/share-links: a signed link to one published file. */
export interface ProjectShareLink {
  url: string;
  /** Seconds since the epoch. */
  expires_at: number;
}
