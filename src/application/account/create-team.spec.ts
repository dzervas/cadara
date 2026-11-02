// Logic lane: the Create team flow through a fake organization port: the
// created team continues to its checkout, and a failed checkout keeps the team.
import { expect, test } from "vitest";
import type { Organization } from "@/contracts/account/organizations";
import { createTeam } from "./create-team";
import type { OrganizationPort } from "./organization-port";

const team: Organization = {
  id: "team",
  name: "Workshop",
  slug: "workshop",
  personal: false,
  allowExternalSharing: true,
  defaultProjectRole: "editor",
};

function fakePort(checkout: () => Promise<string>) {
  const calls: string[] = [];
  const port = {
    createOrganization: async (input: { name: string; slug: string }) => {
      calls.push(`create ${input.name} ${input.slug}`);
      return team;
    },
    startCheckout: async (organizationId: string, tier: string) => {
      calls.push(`checkout ${organizationId} ${tier}`);
      return checkout();
    },
  } as Partial<OrganizationPort> as OrganizationPort;
  return { port, calls };
}

test("a new team continues to the team-plan checkout of the created team", async () => {
  const { port, calls } = fakePort(async () => "https://pay.example/c");
  await expect(
    createTeam(port, { name: "Workshop", slug: "workshop" }),
  ).resolves.toEqual({
    organization: team,
    checkoutUrl: "https://pay.example/c",
  });
  expect(calls).toEqual(["create Workshop workshop", "checkout team team"]);
});

test("a failed checkout keeps the created team and the reason", async () => {
  const failure = new Error("Billing is unavailable right now.");
  const { port } = fakePort(async () => {
    throw failure;
  });
  await expect(
    createTeam(port, { name: "Workshop", slug: "workshop" }),
  ).resolves.toEqual({ organization: team, checkoutError: failure });
});

test("a refused creation fails without starting a checkout", async () => {
  const { port, calls } = fakePort(async () => "unused");
  port.createOrganization = async () => {
    throw new Error("Another team already uses that URL name.");
  };
  await expect(
    createTeam(port, { name: "Workshop", slug: "workshop" }),
  ).rejects.toThrow("Another team already uses that URL name.");
  expect(calls).toEqual([]);
});
