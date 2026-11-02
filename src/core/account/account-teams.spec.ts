// Logic lane: which organizations count as the account's teams (the gate for
// every team surface), the URL-name rule and the per-account dashboard choice.
import { expect, test } from "vitest";
import { makeAccount } from "../../../test/helpers/account-fixtures";
import {
  accountTeams,
  readChosenOrganization,
  rememberChosenOrganization,
  teamSlugFromName,
} from "./account-teams";

function accountWith(
  organizations: { id: string; personal: boolean; role: string }[],
) {
  const account = makeAccount();
  for (const org of organizations) {
    account.organizations.push({
      id: org.id,
      name: `${org.id} name`,
      personal: org.personal,
    });
    account.me.actor.memberships.push({
      ...account.me.actor.memberships[0]!,
      id: `${org.id}-membership`,
      organizationId: org.id,
      role: org.role as "owner",
    });
  }
  return account;
}

test("an account with only its personal workspace and shared projects has no team", () => {
  expect(accountTeams(null)).toEqual([]);
  expect(accountTeams(makeAccount())).toEqual([]);
  expect(
    accountTeams(
      accountWith([
        // Collaborator access to someone's personal or team projects.
        { id: "friend", personal: true, role: "collaborator" },
        { id: "studio", personal: false, role: "collaborator" },
      ]),
    ),
  ).toEqual([]);
});

test("team membership in any role makes the organization a team", () => {
  expect(
    accountTeams(
      accountWith([
        { id: "made", personal: false, role: "owner" },
        { id: "joined", personal: false, role: "member" },
      ]),
    ),
  ).toEqual([
    { id: "made", name: "made name", role: "owner" },
    { id: "joined", name: "joined name", role: "member" },
  ]);
});

test("the URL name follows the service's slug rule", () => {
  expect(teamSlugFromName("  Ünder Workshop #2 ")).toBe("under-workshop-2");
  expect(teamSlugFromName("Personal Shop")).toBe("shop");
  expect(teamSlugFromName("x".repeat(80))).toHaveLength(63);
  expect(teamSlugFromName("!!!")).toBe("");
});

test("the dashboard's chosen workspace belongs to the account that chose it", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
  expect(readChosenOrganization(storage, "ada")).toBeNull();
  rememberChosenOrganization(storage, "ada", "team");
  expect(readChosenOrganization(storage, "ada")).toBe("team");
  expect(readChosenOrganization(storage, "bob")).toBeNull();
});
