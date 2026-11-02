// Infrastructure lane: the organization HTTP adapter speaks the service's
// /orgs routes with the session cookie, reads its records leniently and turns
// refusals into messages a person can act on.
import { expect, test } from "vitest";
import { createOrganizationHttpClient } from "./organizations";

interface RecordedRequest {
  method: string;
  path: string;
  credentials: RequestCredentials | undefined;
  body: unknown;
}

function makeClient(
  respond: (request: RecordedRequest) => { status: number; body: unknown },
) {
  const requests: RecordedRequest[] = [];
  const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const request: RecordedRequest = {
      method: init?.method ?? "GET",
      path: new URL(String(input)).pathname,
      credentials: init?.credentials,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    requests.push(request);
    const { status, body } = respond(request);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return {
    requests,
    client: createOrganizationHttpClient({
      apiOrigin: "https://api.example.test",
      fetcher,
    }),
  };
}

// As the service returns it: Better Auth columns the client does not read.
const organization = {
  id: "team",
  name: "Workshop",
  slug: "workshop",
  logo: null,
  metadata: null,
  createdAt: "2026-11-02T00:00:00.000Z",
  deletedAt: null,
  personal: false,
  allowExternalSharing: true,
  defaultProjectRole: "editor",
};

test("team management calls the /orgs routes with the session cookie", async () => {
  const { client, requests } = makeClient(({ path }) => ({
    status: 200,
    body: path.endsWith("/members")
      ? {
          members: [
            {
              id: "m1",
              userId: "u1",
              role: "owner",
              defaultProjectRole: "editor",
              createdAt: "2026-11-02T00:00:00.000Z",
              user: { id: "u1", name: "", email: "ada@example.test" },
            },
          ],
          total: 1,
        }
      : path.endsWith("/checkout")
        ? { url: "https://pay.example.test/c", id: "c" }
        : path.endsWith("/invitations")
          ? []
          : organization,
  }));
  await expect(
    client.createOrganization({ name: "Workshop", slug: "workshop" }),
  ).resolves.toMatchObject({ id: "team", personal: false });
  await expect(client.listMembers("team")).resolves.toMatchObject([
    { id: "m1", role: "owner", user: { email: "ada@example.test" } },
  ]);
  await client.updateMember("team", "m1", { defaultProjectRole: "viewer" });
  await client.updateOrganization("team", { allowExternalSharing: false });
  await client.listInvitations("team");
  await client.cancelInvitation("team", "i1");
  await client.removeMember("team", "m1");
  await expect(client.startCheckout("team", "team")).resolves.toBe(
    "https://pay.example.test/c",
  );
  expect(
    requests.map(({ method, path, body }) => [method, path, body]),
  ).toEqual([
    ["POST", "/orgs", { name: "Workshop", slug: "workshop" }],
    ["GET", "/orgs/team/members", undefined],
    ["PATCH", "/orgs/team/members/m1", { defaultProjectRole: "viewer" }],
    ["PATCH", "/orgs/team", { allowExternalSharing: false }],
    ["GET", "/orgs/team/invitations", undefined],
    // The service refuses writes without a JSON body (HTTP 415).
    ["DELETE", "/orgs/team/invitations/i1", {}],
    ["DELETE", "/orgs/team/members/m1", {}],
    ["POST", "/orgs/team/billing/checkout", { tier: "team" }],
  ]);
  expect(requests.every((request) => request.credentials === "include")).toBe(
    true,
  );
});

test("service refusals become actionable messages", async () => {
  const refusal = (status: number, body: unknown) =>
    makeClient(() => ({ status, body })).client;
  await expect(
    refusal(400, {
      error: "Organization request rejected",
      code: "ORGANIZATION_ALREADY_EXISTS",
    }).createOrganization({ name: "Workshop", slug: "workshop" }),
  ).rejects.toThrow("Another team already uses that URL name.");
  await expect(
    refusal(400, {
      error: "Organization request rejected",
      code: "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION",
    }).inviteMember("team", { email: "a@example.test", role: "member" }),
  ).rejects.toThrow("That email already has a pending invitation.");
  await expect(
    refusal(403, { error: "Forbidden" }).removeMember("team", "m1"),
  ).rejects.toThrow("Only the team's owner and admins can do this.");
  await expect(
    refusal(503, { error: "Billing not configured" }).startCheckout(
      "team",
      "team",
    ),
  ).rejects.toThrow("Billing is unavailable right now.");
});

test("an organization record without the personal flag is rejected", async () => {
  const { client } = makeClient(() => ({
    status: 200,
    body: { ...organization, personal: undefined },
  }));
  await expect(client.getOrganization("team")).rejects.toThrow();
});
