import type { Account } from "@/contracts/account/account";
import type { TeamRole } from "@/contracts/account/organizations";

export interface AccountTeam {
  id: string;
  name: string;
  role: TeamRole;
}

/**
 * The teams the account belongs to. A personal workspace is never a team, and
 * collaborator access to a team's shared projects is not team membership:
 * without a team, the interface never speaks of teams or organizations.
 */
export function accountTeams(account: Account | null): AccountTeam[] {
  if (!account) return [];
  return account.organizations.flatMap((organization) => {
    const role = account.me.actor.memberships.find(
      (membership) => membership.organizationId === organization.id,
    )?.role;
    return !organization.personal && role && role !== "collaborator"
      ? [{ id: organization.id, name: organization.name, role }]
      : [];
  });
}

/** The service's slug rule: 1-63 of `a-z`, `0-9` and `-`, never `personal-…`. */
export function teamSlugFromName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/, "")
    .replace(/^personal-/, "");
}

const CHOSEN_ORGANIZATION_KEY = "cad.dashboardOrganization.v1";

/**
 * The dashboard's chosen workspace, per account: creating a team in the
 * editor opens the dashboard on that team.
 */
export function readChosenOrganization(
  storage: Pick<Storage, "getItem">,
  userId: string,
): string | null {
  const stored = storage.getItem(CHOSEN_ORGANIZATION_KEY);
  if (!stored) return null;
  const [owner, organizationId] = stored.split("\n");
  return owner === userId && organizationId ? organizationId : null;
}

export function rememberChosenOrganization(
  storage: Pick<Storage, "setItem">,
  userId: string,
  organizationId: string,
) {
  storage.setItem(CHOSEN_ORGANIZATION_KEY, `${userId}\n${organizationId}`);
}
