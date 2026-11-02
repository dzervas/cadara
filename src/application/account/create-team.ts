import type { Organization } from "@/contracts/account/organizations";
import type { OrganizationPort } from "./organization-port";

export interface CreateTeamInput {
  name: string;
  slug: string;
}

export type CreateTeamResult =
  | { organization: Organization; checkoutUrl: string }
  /** The team exists; only its checkout failed and can be retried later. */
  | { organization: Organization; checkoutError: unknown };

/**
 * Creates the team, then starts its team-plan checkout (a team is always on
 * the team plan). A failed creation throws; a failed checkout keeps the team.
 */
export async function createTeam(
  port: OrganizationPort,
  input: CreateTeamInput,
): Promise<CreateTeamResult> {
  const organization = await port.createOrganization(input);
  try {
    return {
      organization,
      checkoutUrl: await port.startCheckout(organization.id, "team"),
    };
  } catch (checkoutError) {
    return { organization, checkoutError };
  }
}
