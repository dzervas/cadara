import type { OrganizationRole, ProjectRole } from "./account";

/** Roles inside a team; collaborators reach individual projects only. */
export type TeamRole = Exclude<OrganizationRole, "collaborator">;

/** GET /orgs and GET /orgs/:orgId (the fields the client reads). */
export interface Organization {
  id: string;
  name: string;
  slug: string;
  /** The account's own workspace: it never has members besides its owner. */
  personal: boolean;
  /** False: team projects can be shared only with team members. */
  allowExternalSharing: boolean;
  defaultProjectRole: ProjectRole;
}

/** What the account session keeps of each GET /orgs row. */
export type OrganizationSummary = Pick<
  Organization,
  "id" | "name" | "personal"
>;

/** One row of GET /orgs/:orgId/members (collaborators are filtered out). */
export interface OrganizationMember {
  id: string;
  userId: string;
  role: TeamRole;
  defaultProjectRole: ProjectRole;
  user: { id: string; name: string; email: string };
}

export interface OrganizationMembers {
  members: OrganizationMember[];
}

/** One row of GET /orgs/:orgId/invitations. */
export interface OrganizationInvitation {
  id: string;
  email: string;
  role: TeamRole;
  status: "pending" | "accepted" | "rejected" | "canceled";
  expiresAt: string;
}

/** POST /orgs/:orgId/billing/checkout: the hosted checkout to open. */
export interface BillingCheckout {
  url: string;
}
