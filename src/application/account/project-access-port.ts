import type { ProjectRole } from "@/contracts/account/account";
import type {
  ProjectDetails,
  ProjectInviteOutcome,
  ProjectPeople,
  ProjectShareLink,
  ProjectVersionSummary,
} from "@/contracts/account/project-access";
import type { ProjectServiceLink } from "@/contracts/modeling/project-manifest";

/** Why the service refused a sharing change, for an inline explanation. */
export type ProjectAccessRefusalReason =
  /** Another editor would exceed the owner's plan; `limit` and `used` say by how much. */
  | { kind: "editor-limit"; limit: number; used: number }
  /** The team does not allow inviting people from outside it. */
  | { kind: "external-sharing-disabled" }
  /** Too many invites, or this email was just sent one. */
  | { kind: "rate-limited" }
  /** The caller's role does not allow the change. */
  | { kind: "forbidden" };

export class ProjectAccessRefusal extends Error {
  readonly reason: ProjectAccessRefusalReason;

  constructor(reason: ProjectAccessRefusalReason, message: string) {
    super(message);
    this.name = "ProjectAccessRefusal";
    this.reason = reason;
  }
}

/** Who has access to an account project and how it is shared. */
export interface ProjectAccessPort {
  getProject(link: ProjectServiceLink): Promise<ProjectDetails>;
  listPeople(link: ProjectServiceLink): Promise<ProjectPeople>;
  invite(
    link: ProjectServiceLink,
    email: string,
    role: ProjectRole,
  ): Promise<ProjectInviteOutcome>;
  resendInvite(link: ProjectServiceLink, inviteId: string): Promise<void>;
  revokeInvite(link: ProjectServiceLink, inviteId: string): Promise<void>;
  setRole(
    link: ProjectServiceLink,
    userId: string,
    role: ProjectRole,
  ): Promise<void>;
  removePerson(link: ProjectServiceLink, userId: string): Promise<void>;
  leave(link: ProjectServiceLink): Promise<void>;
  /** Off invalidates every link handed out; on starts a new link. */
  setShareLinksEnabled(
    link: ProjectServiceLink,
    enabled: boolean,
  ): Promise<void>;
  /** Replaces the link while links are on; old links stop working. */
  rotateShareLinks(link: ProjectServiceLink): Promise<void>;
  listVersions(link: ProjectServiceLink): Promise<ProjectVersionSummary[]>;
  /**
   * A link to one file of a published version. Only while links are on:
   * minting while they are off would turn them back on.
   */
  mintShareLink(
    link: ProjectServiceLink,
    versionId: string,
    fileName: string,
  ): Promise<ProjectShareLink>;
  deleteProject(link: ProjectServiceLink): Promise<void>;
}
