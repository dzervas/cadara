export type OrganizationRole = "owner" | "admin" | "member";
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
      defaultProjectRole: ProjectRole;
    }[];
    projectGrants: { projectId: string; role: ProjectRole }[];
  };
  organizations: {
    organizationId: string;
    entitlements: {
      tier: "free" | "individual" | "team";
      storage_limit_bytes: number;
      private_project_limit: number | null;
      collaborator_limit: number | null;
      seat_count: number;
    };
  }[];
}

export interface Account {
  user: { id: string; name: string; email: string };
  me: AccountMe;
  organizations: { id: string; name: string }[];
}
