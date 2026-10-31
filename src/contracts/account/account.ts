/**
 * `collaborator` is access to individually shared projects only: no default
 * project role, never shown as team membership.
 */
export type OrganizationRole = "owner" | "admin" | "member" | "collaborator";
export type ProjectRole = "admin" | "editor" | "commenter" | "viewer";

/** Cookie-session view of GET /me; API-key actors are not browser sessions. */
export interface AccountMe {
  actor: {
    userId: string;
    credential: { kind: "session" };
    memberships: {
      id: string;
      userId: string;
      createdAt: string;
      organizationId: string;
      role: OrganizationRole;
      /** Null exactly for `collaborator` memberships. */
      defaultProjectRole: ProjectRole | null;
    }[];
    projectGrants: { projectId: string; role: ProjectRole }[];
  };
  organizations: {
    organizationId: string;
    entitlements: {
      tier: "free" | "individual" | "team";
      storage_limit_bytes: number;
      private_project_limit: number | null;
      /** Editors and admins per project besides the owner; null is unlimited. */
      project_editor_limit: number | null;
      seat_count: number;
    };
    usage: {
      storage_bytes: number;
      private_projects: number;
    };
  }[];
}

export interface Account {
  user: { id: string; name: string; email: string };
  me: AccountMe;
  organizations: { id: string; name: string }[];
}
