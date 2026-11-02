import type { ProjectRole } from "@/contracts/account/account";
import type {
  Organization,
  OrganizationInvitation,
  OrganizationMember,
  TeamRole,
} from "@/contracts/account/organizations";

/** Team management on the account service (`/orgs/...`). */
export interface OrganizationPort {
  createOrganization(input: {
    name: string;
    slug: string;
  }): Promise<Organization>;
  getOrganization(organizationId: string): Promise<Organization>;
  updateOrganization(
    organizationId: string,
    input: { allowExternalSharing: boolean },
  ): Promise<Organization>;
  listMembers(organizationId: string): Promise<OrganizationMember[]>;
  updateMember(
    organizationId: string,
    memberId: string,
    input: {
      role?: Exclude<TeamRole, "owner">;
      defaultProjectRole?: ProjectRole;
    },
  ): Promise<void>;
  removeMember(organizationId: string, memberId: string): Promise<void>;
  listInvitations(organizationId: string): Promise<OrganizationInvitation[]>;
  inviteMember(
    organizationId: string,
    input: { email: string; role: Exclude<TeamRole, "owner"> },
  ): Promise<OrganizationInvitation>;
  cancelInvitation(organizationId: string, invitationId: string): Promise<void>;
  /** Starts the hosted checkout for a paid plan; resolves to its URL. */
  startCheckout(organizationId: string, tier: "team"): Promise<string>;
}
