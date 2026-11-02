import type { OrganizationPort } from "@/application/account/organization-port";
import {
  parseOrganization,
  parseOrganizationInvitation,
  parseOrganizationInvitations,
  parseOrganizationMembers,
} from "@/contracts/account/organizations.runtime-schema";
import { createBillingClient } from "./billing";

const SERVICE_ERRORS: Record<string, string> = {
  ORGANIZATION_ALREADY_EXISTS: "Another team already uses that URL name.",
  ORGANIZATION_SLUG_ALREADY_TAKEN: "Another team already uses that URL name.",
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION:
    "That person is already a member.",
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION:
    "That email already has a pending invitation.",
};

async function failure(response: Response, fallback: string) {
  // A body that is not JSON keeps the status-based message below.
  const body: unknown = await response.json().catch(() => null);
  const code =
    body && typeof body === "object" && "code" in body ? String(body.code) : "";
  if (SERVICE_ERRORS[code]) return new Error(SERVICE_ERRORS[code]);
  if (response.status === 401)
    return new Error("Sign in to CADara to manage your team.");
  if (response.status === 403)
    return new Error("Only the team's owner and admins can do this.");
  if (response.status === 400) return new Error(`${fallback}.`);
  return new Error(`${fallback} (HTTP ${response.status}).`);
}

export function createOrganizationHttpClient({
  apiOrigin,
  fetcher = (input, init) => fetch(input, init),
}: {
  apiOrigin: string;
  fetcher?: typeof fetch;
}): OrganizationPort {
  const call = async (
    path: string,
    fallback: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<unknown> => {
    const response = await fetcher(new URL(path, apiOrigin), {
      method: init.method ?? "GET",
      credentials: "include",
      ...(init.body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(init.body),
          }),
    });
    if (!response.ok) throw await failure(response, fallback);
    return response.json();
  };
  const org = (organizationId: string) =>
    `/orgs/${encodeURIComponent(organizationId)}`;
  const billing = createBillingClient({ apiOrigin, fetcher });
  return {
    async createOrganization(input) {
      return parseOrganization(
        await call(
          "/orgs",
          "The team could not be created. The URL name may be reserved; it uses lowercase letters, numbers and dashes",
          { method: "POST", body: input },
        ),
      );
    },
    async getOrganization(organizationId) {
      return parseOrganization(
        await call(org(organizationId), "The team could not be loaded"),
      );
    },
    async updateOrganization(organizationId, input) {
      return parseOrganization(
        await call(org(organizationId), "The team could not be updated", {
          method: "PATCH",
          body: input,
        }),
      );
    },
    async listMembers(organizationId) {
      return parseOrganizationMembers(
        await call(
          `${org(organizationId)}/members`,
          "The members could not be loaded",
        ),
      );
    },
    async updateMember(organizationId, memberId, input) {
      await call(
        `${org(organizationId)}/members/${encodeURIComponent(memberId)}`,
        "The member could not be updated",
        { method: "PATCH", body: input },
      );
    },
    async removeMember(organizationId, memberId) {
      await call(
        `${org(organizationId)}/members/${encodeURIComponent(memberId)}`,
        "The member could not be removed",
        // The service accepts only JSON request bodies on writes.
        { method: "DELETE", body: {} },
      );
    },
    async listInvitations(organizationId) {
      return parseOrganizationInvitations(
        await call(
          `${org(organizationId)}/invitations`,
          "The invitations could not be loaded",
        ),
      );
    },
    async inviteMember(organizationId, input) {
      return parseOrganizationInvitation(
        await call(
          `${org(organizationId)}/invitations`,
          "The invitation could not be sent. Check the email address",
          { method: "POST", body: input },
        ),
      );
    },
    async cancelInvitation(organizationId, invitationId) {
      await call(
        `${org(organizationId)}/invitations/${encodeURIComponent(invitationId)}`,
        "The invitation could not be revoked",
        { method: "DELETE", body: {} },
      );
    },
    startCheckout: (organizationId, tier) =>
      billing.startCheckout(organizationId, tier),
  };
}
