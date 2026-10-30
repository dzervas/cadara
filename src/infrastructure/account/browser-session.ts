import { createAuthClient } from "better-auth/client";
import {
  magicLinkClient,
  organizationClient,
} from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import type { SessionPort } from "@/application/account/session-port";
import { parseAccountMe } from "@/contracts/account/account.runtime-schema";

export function createBrowserSession({
  apiOrigin,
  callbackURL,
  fetcher = fetch,
}: {
  apiOrigin: string;
  callbackURL: string;
  fetcher?: typeof fetch;
}): SessionPort {
  const client = createAuthClient({
    baseURL: apiOrigin,
    fetchOptions: { credentials: "include", customFetchImpl: fetcher },
    plugins: [magicLinkClient(), organizationClient(), passkeyClient()],
  });
  const requireSuccess = (result: { error: { message?: string } | null }) => {
    if (result.error)
      throw new Error(result.error.message ?? "Account request failed.");
  };
  return {
    async getAccount() {
      const session = await client.getSession();
      requireSuccess(session);
      if (!session.data) return null;
      const [meResponse, orgResponse] = await Promise.all([
        fetcher(new URL("/me", apiOrigin), { credentials: "include" }),
        fetcher(new URL("/orgs", apiOrigin), { credentials: "include" }),
      ]);
      if (!meResponse.ok || !orgResponse.ok)
        throw new Error("Unable to load your account.");
      const me = parseAccountMe(await meResponse.json());
      const orgs: unknown = await orgResponse.json();
      if (
        !Array.isArray(orgs) ||
        !orgs.every(
          (org: unknown) =>
            typeof org === "object" &&
            org !== null &&
            "id" in org &&
            typeof org.id === "string" &&
            "name" in org &&
            typeof org.name === "string",
        )
      )
        throw new Error("Invalid account organizations.");
      if (me.actor.userId !== session.data.user.id)
        throw new Error("Account identity mismatch.");
      return {
        user: {
          id: session.data.user.id,
          name: session.data.user.name,
          email: session.data.user.email,
        },
        me,
        organizations: orgs.map((org) => ({
          id: org.id as string,
          name: org.name as string,
        })),
      };
    },
    async requestMagicLink(email) {
      requireSuccess(
        await client.signIn.magicLink({
          email,
          callbackURL,
          errorCallbackURL: `${callbackURL}?accountError=link`,
        }),
      );
    },
    async signInSocial(provider) {
      requireSuccess(
        await client.signIn.social({
          provider,
          callbackURL,
          errorCallbackURL: `${callbackURL}?accountError=oauth`,
        }),
      );
    },
    async signInPasskey() {
      requireSuccess(await client.signIn.passkey());
    },
    async registerPasskey() {
      requireSuccess(await client.passkey.addPasskey({ name: "CADara" }));
    },
    async signOut() {
      requireSuccess(await client.signOut());
    },
  };
}
