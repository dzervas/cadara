import { createAuthClient } from "better-auth/client";
import { passkeyClient } from "@better-auth/passkey/client";
import type {
  ApiKeyScope,
  ApiKeySummary,
  CreatedApiKey,
} from "@/contracts/account/account-settings";
import {
  parseApiKeys,
  parseCreatedApiKey,
} from "@/contracts/account/account-settings.runtime-schema";
import { accountApiError } from "./account-api-error";

export interface PasskeySummary {
  id: string;
  name: string | null;
  createdAt: string;
}

/** Workspace key access levels offered in Settings; org:admin is never offered. */
export type ApiKeyAccess = "read" | "read-write";

export const apiKeyAccessScopes: Record<ApiKeyAccess, ApiKeyScope[]> = {
  read: ["project:read"],
  "read-write": [
    "project:read",
    "project:write",
    "project:create",
    "project:delete",
  ],
};

export type AccountDeletionResult =
  | { deleted: true }
  /** Teams the user owns block deletion until transferred or deleted. */
  | { deleted: false; ownedOrganizationIds: string[] };

export interface AccountSettingsClient {
  updateName(name: string): Promise<void>;
  listPasskeys(): Promise<PasskeySummary[]>;
  addPasskey(): Promise<void>;
  deletePasskey(id: string): Promise<void>;
  listApiKeys(organizationId: string): Promise<ApiKeySummary[]>;
  createApiKey(
    organizationId: string,
    name: string,
    access: ApiKeyAccess,
  ): Promise<CreatedApiKey>;
  revokeApiKey(organizationId: string, keyId: string): Promise<void>;
  /** The account archive: a zip of the account, its projects and files. */
  downloadExport(): Promise<Blob>;
  deleteAccount(): Promise<AccountDeletionResult>;
}

// The account API refuses writes that carry a non-JSON body (415), and on
// Workers even a body-less DELETE arrives with a body stream, so it declares JSON.
const jsonOnly = { "Content-Type": "application/json" };

export function createAccountSettingsClient({
  apiOrigin,
  fetcher = fetch,
}: {
  apiOrigin: string;
  fetcher?: typeof fetch;
}): AccountSettingsClient {
  const auth = createAuthClient({
    baseURL: apiOrigin,
    fetchOptions: { credentials: "include", customFetchImpl: fetcher },
    plugins: [passkeyClient()],
  });
  const requireSuccess = (result: { error: { message?: string } | null }) => {
    if (result.error)
      throw new Error(result.error.message ?? "Account request failed.");
  };
  const request = async (
    path: string,
    fallback: string,
    init: RequestInit = {},
  ) => {
    const response = await fetcher(new URL(path, apiOrigin), {
      credentials: "include",
      ...init,
    });
    if (!response.ok) throw await accountApiError(response, fallback);
    return response;
  };
  const keysPath = (organizationId: string) =>
    `/orgs/${encodeURIComponent(organizationId)}/api-keys`;
  return {
    async updateName(name) {
      requireSuccess(await auth.updateUser({ name }));
    },
    async listPasskeys() {
      const result = await auth.passkey.listUserPasskeys();
      requireSuccess(result);
      return (result.data ?? []).map((passkey) => ({
        id: passkey.id,
        name: passkey.name ?? null,
        createdAt: new Date(passkey.createdAt).toISOString(),
      }));
    },
    async addPasskey() {
      requireSuccess(await auth.passkey.addPasskey({ name: "CADara" }));
    },
    async deletePasskey(id) {
      requireSuccess(await auth.passkey.deletePasskey({ id }));
    },
    async listApiKeys(organizationId) {
      const response = await request(
        keysPath(organizationId),
        "Unable to load API keys.",
      );
      return parseApiKeys(await response.json());
    },
    async createApiKey(organizationId, name, access) {
      const response = await request(
        keysPath(organizationId),
        "Unable to create the API key.",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, scopes: apiKeyAccessScopes[access] }),
        },
      );
      return parseCreatedApiKey(await response.json());
    },
    async revokeApiKey(organizationId, keyId) {
      await request(
        `${keysPath(organizationId)}/${encodeURIComponent(keyId)}`,
        "Unable to revoke the API key.",
        { method: "DELETE", headers: jsonOnly },
      );
    },
    async downloadExport() {
      const response = await fetcher(new URL("/me/export", apiOrigin), {
        credentials: "include",
      });
      if (response.status === 413)
        throw new Error("Your data is too large to export as one archive.");
      if (!response.ok)
        throw await accountApiError(response, "Unable to export your data.");
      return response.blob();
    },
    async deleteAccount() {
      const response = await fetcher(new URL("/me", apiOrigin), {
        method: "DELETE",
        credentials: "include",
        headers: jsonOnly,
      });
      if (response.status === 409) {
        const body: unknown = await response.json();
        if (
          typeof body === "object" &&
          body !== null &&
          "organizations" in body &&
          Array.isArray(body.organizations) &&
          body.organizations.every((id) => typeof id === "string")
        )
          return {
            deleted: false,
            ownedOrganizationIds: body.organizations as string[],
          };
      }
      if (!response.ok)
        throw await accountApiError(response, "Unable to delete your account.");
      return { deleted: true };
    },
  };
}
