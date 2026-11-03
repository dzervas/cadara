import { createAuthClient } from "better-auth/client";
import {
  magicLinkClient,
  emailOTPClient,
  organizationClient,
} from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import type { SessionPort } from "@/application/account/session-port";
import { parseAccountMe } from "@/contracts/account/account.runtime-schema";
import { parseOrganizationSummaries } from "@/contracts/account/organizations.runtime-schema";

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
    plugins: [
      magicLinkClient(),
      emailOTPClient(),
      organizationClient(),
      passkeyClient(),
    ],
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
      const orgs = parseOrganizationSummaries(await orgResponse.json());
      if (me.actor.userId !== session.data.user.id)
        throw new Error("Account identity mismatch.");
      return {
        user: {
          id: session.data.user.id,
          name: session.data.user.name,
          email: session.data.user.email,
        },
        me,
        organizations: orgs.map(({ id, name, personal }) => ({
          id,
          name,
          personal,
        })),
      };
    },
    async requestMagicLink(email) {
      const result = await client.signIn.magicLink({
        email,
        callbackURL: `${callbackURL}?accountSignedIn=1`,
        errorCallbackURL: `${callbackURL}?accountError=link`,
      });
      // A cooldown refusal still means the address holds a live code: the
      // caller moves to the code step and waits the server's remaining time.
      const cooldown = result.error as { retryAfterSeconds?: unknown } | null;
      if (
        result.error?.status === 429 &&
        typeof cooldown?.retryAfterSeconds === "number"
      )
        return { resendAfterSeconds: cooldown.retryAfterSeconds };
      requireSuccess(result);
      const sent = result.data as { resendAfterSeconds?: unknown } | null;
      return {
        resendAfterSeconds:
          typeof sent?.resendAfterSeconds === "number"
            ? sent.resendAfterSeconds
            : 0,
      };
    },
    async redeemEmailCode(email, code) {
      requireSuccess(await client.signIn.emailOtp({ email, otp: code }));
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
    async signInPasskey(options) {
      requireSuccess(await client.signIn.passkey(options));
    },
    async registerPasskey() {
      requireSuccess(await client.passkey.addPasskey({ name: "CADara" }));
    },
    async signOut() {
      requireSuccess(await client.signOut());
    },
  };
}
